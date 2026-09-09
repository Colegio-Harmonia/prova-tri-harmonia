import type { docs_v1 } from 'googleapis'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { findMarkerRange } from './richTextInsert'
import type { AssessmentMeta } from './assessmentMeta'
import { splitLatexSegments, IMAGE_ALTERNATIVE_PLACEHOLDER } from '@/lib/math/latexRender'
import { buildLatexImageCache, type LatexImageCache } from './latexImageCache'
import { buildMarkdownTableImageCache, splitMarkdownTables, type MarkdownTableImageCache } from './markdownTableImageCache'

const BLANK_LINE = '_'.repeat(60)

type ProvaOp =
  | { kind: 'text'; text: string; bold?: boolean }
  // `size` ausente = imagem de apoio da questão (grande, fixa); presente =
  // fórmula matemática inline (tamanho real da renderização, ver latexImageCache.ts).
  | { kind: 'image'; driveFileId: string; size?: { widthPt: number; heightPt: number } }

/**
 * Quebra um texto em ops de texto/imagem, trocando cada $...$ pela fórmula
 * já renderizada (via latexCache) — quando uma fórmula não resolveu (falha
 * de rede no serviço externo), cai pro LaTeX cru em vez de sumir com o
 * conteúdo da questão.
 */
function textToOps(text: string, latexCache: LatexImageCache, bold?: boolean): ProvaOp[] {
  return splitLatexSegments(text).flatMap((seg): ProvaOp[] => {
    if (seg.type === 'text') {
      return seg.content ? [{ kind: 'text', text: seg.content, bold }] : []
    }
    const info = latexCache.get(seg.latex)
    return info
      ? [{ kind: 'image', driveFileId: info.driveFileId, size: { widthPt: info.widthPt, heightPt: info.heightPt } }]
      : [{ kind: 'text', text: seg.latex, bold }]
  })
}

function markdownTextToOps(text: string, latexCache: LatexImageCache, tableCache: MarkdownTableImageCache, bold?: boolean): ProvaOp[] {
  return splitMarkdownTables(text).flatMap((block): ProvaOp[] => {
    if (block.kind === 'text') return textToOps(block.text, latexCache, bold)
    const image = tableCache.get(block.table.raw)
    // A tabela nunca desaparece se o Drive ou o renderer falhar: conserva o
    // Markdown original como fallback, em vez de publicar uma questão vazia.
    if (!image) return textToOps(block.table.raw, latexCache, bold)
    return [
      { kind: 'image', driveFileId: image.driveFileId, size: { widthPt: image.widthPt, heightPt: image.heightPt } },
      { kind: 'text', text: '\n' },
    ]
  })
}

/**
 * Builds a sequence of text/image ops per question instead of one plain-text
 * blob, so approved question images (e outra vez as fórmulas matemáticas)
 * land right after the statement/support text — a single insertText call
 * can't interleave inline images.
 */
export type ProvaBuildOptions = {
  // Linhas de resposta das descritivas — a Prova Adaptada (discalculia)
  // usa espaço ampliado de cálculo sem mexer no default da prova comum.
  discursiveBlankLines?: number
}

export function buildProvaOps(exam: ExamGenerationResult, latexCache: LatexImageCache, tableCache: MarkdownTableImageCache, options: ProvaBuildOptions = {}): ProvaOp[] {
  const discursiveBlankLines = options.discursiveBlankLines ?? 5
  const ops: ProvaOp[] = []

  for (const q of exam.questions) {
    // O número abre o bloco e o texto de apoio vem ANTES do enunciado —
    // mesma ordem da tela de revisão. Questão do banco ENEM tem enunciado
    // que é continuação direta do apoio ("Ao abaixar o fogo, reduz-se a
    // chama, pois assim evita-se o(a)") e fica incompreensível impressa na
    // ordem inversa.
    ops.push({ kind: 'text', text: `${q.number}. ` })

    if (q.supportText) {
      ops.push(...markdownTextToOps(q.supportText, latexCache, tableCache))
      ops.push({ kind: 'text', text: '\n' })
    }

    ops.push(...markdownTextToOps(q.statement, latexCache, tableCache))
    ops.push({ kind: 'text', text: '\n' })

    if (q.image?.approved) {
      ops.push({ kind: 'image', driveFileId: q.image.driveFileId })
      ops.push({ kind: 'text', text: '\n' })
    }

    if (q.type === 'objetiva' && q.alternatives) {
      for (const alt of q.alternatives) {
        ops.push({ kind: 'text', text: `${alt.letter}) ` })
        // Alternativa-imagem do ENEM chega com text null: marca em vez de
        // imprimir em branco (e o markdownTextToOps já é null-safe).
        ops.push(...markdownTextToOps(alt.text || IMAGE_ALTERNATIVE_PLACEHOLDER, latexCache, tableCache))
        ops.push({ kind: 'text', text: '\n' })
      }
    } else {
      for (let i = 0; i < discursiveBlankLines; i++) {
        ops.push({ kind: 'text', text: `${BLANK_LINE}\n` })
      }
    }

    ops.push({ kind: 'text', text: '\n' })
  }

  return ops
}

// Imagem de apoio "grande" (foto/mapa/gráfico da questão) quando o op não
// carrega um `size` próprio — fórmula matemática sempre carrega o dela.
const DEFAULT_IMAGE_SIZE = { width: { magnitude: 260, unit: 'PT' }, height: { magnitude: 180, unit: 'PT' } }

export function buildOpsRequests(ops: ProvaOp[], startIndex: number): docs_v1.Schema$Request[] {
  const requests: docs_v1.Schema$Request[] = []
  let cursor = startIndex

  for (const op of ops) {
    if (op.kind === 'text') {
      requests.push({ insertText: { location: { index: cursor }, text: op.text } })
      // O texto inserido herda o estilo do marcador {{CORPO_PROVA}}. Como o
      // template pode deixá-lo em negrito, sempre definimos o peso do corpo
      // de forma explícita para não transformar toda a prova em título.
      requests.push({
        updateTextStyle: {
          range: { startIndex: cursor, endIndex: cursor + op.text.length },
          textStyle: { bold: op.bold ?? false },
          fields: 'bold',
        },
      })
      cursor += op.text.length
    } else {
      requests.push({
        insertInlineImage: {
          location: { index: cursor },
          uri: `https://drive.google.com/uc?id=${op.driveFileId}`,
          objectSize: op.size
            ? { width: { magnitude: op.size.widthPt, unit: 'PT' }, height: { magnitude: op.size.heightPt, unit: 'PT' } }
            : DEFAULT_IMAGE_SIZE,
        },
      })
      // An inline image occupies exactly one index position in the Docs
      // content model, same as a single character.
      cursor += 1
    }
  }

  return requests
}

/**
 * Fills the header placeholders and the {{CORPO_PROVA}} marker on a copy of
 * the Prova template. No gabarito/BNCC info is written to this doc, per the
 * spec's explicit rule.
 */
export async function applyProvaContent(
  docs: docs_v1.Docs,
  documentId: string,
  exam: ExamGenerationResult,
  meta: AssessmentMeta,
  options: ProvaBuildOptions = {},
): Promise<void> {
  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        { replaceAllText: { containsText: { text: '{{ANO}}', matchCase: true }, replaceText: meta.ano } },
        { replaceAllText: { containsText: { text: '{{BIMESTRE}}', matchCase: true }, replaceText: meta.bimestre } },
        { replaceAllText: { containsText: { text: '{{DISCIPLINA}}', matchCase: true }, replaceText: meta.disciplina } },
        { replaceAllText: { containsText: { text: '{{TITULO_PROVA}}', matchCase: true }, replaceText: meta.tituloProva } },
      ],
    },
  })

  const { data: document } = await docs.documents.get({ documentId })
  const markerRange = findMarkerRange(document, '{{CORPO_PROVA}}')
  if (!markerRange) throw new Error('Marcador {{CORPO_PROVA}} não encontrado no template da Prova.')

  const latexCache = await buildLatexImageCache(exam)
  const tableCache = await buildMarkdownTableImageCache(exam)

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        { deleteContentRange: { range: { startIndex: markerRange.start, endIndex: markerRange.end } } },
        ...buildOpsRequests(buildProvaOps(exam, latexCache, tableCache, options), markerRange.start),
      ],
    },
  })
}
