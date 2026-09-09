import type { docs_v1 } from 'googleapis'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { findMarkerRange, buildReplaceMarkerRequests, type TextRange } from './richTextInsert'
import type { AssessmentMeta } from './assessmentMeta'
import { stripLatexDelimiters } from '@/lib/math/latexRender'

export function buildGabaritoBody(exam: ExamGenerationResult): { text: string; boldRanges: TextRange[] } {
  let text = ''
  const boldRanges: TextRange[] = []

  for (const q of exam.questions) {
    const start = text.length
    const numberLabel = `${q.number}. `
    text += numberLabel
    boldRanges.push({ start, end: start + numberLabel.length })

    if (q.type === 'objetiva') {
      text += `${q.correctLetter ?? '—'}\n`
      // Gabarito Comentado (reforço ENEM, Módulo 3): resolução passo a
      // passo gerada por IA depois da seleção. Markdown de ênfase vira
      // texto plano aqui — o Docs não interpreta `**`/`#` e eles só
      // sujariam o documento.
      if (q.commentedResolution) {
        const plain = stripLatexDelimiters(q.commentedResolution).replace(/\*\*|__|^#+\s*/gm, '')
        text += `   Resolução comentada: ${plain}\n\n`
      }
    } else {
      // Gabarito não tem o mesmo pipeline de imagem inline da Prova — em
      // vez de tipografar a fórmula, tira os delimitadores $...$ e mostra
      // o LaTeX cru como texto (ex: "3 \cdot 2^{n-1}"). Legível o
      // suficiente pro professor conferir a resposta, mesmo sem ficar
      // bonito como no documento da prova.
      text += `Resposta esperada: ${stripLatexDelimiters(q.expectedAnswer ?? '—')}\n`
      text += `   Critérios de correção: ${stripLatexDelimiters(q.gradingCriteria ?? '—')}\n`
    }
  }

  return { text, boldRanges }
}

export async function applyGabaritoContent(
  docs: docs_v1.Docs,
  documentId: string,
  exam: ExamGenerationResult,
  meta: AssessmentMeta,
): Promise<void> {
  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        { replaceAllText: { containsText: { text: '{{ANO}}', matchCase: true }, replaceText: meta.ano } },
        { replaceAllText: { containsText: { text: '{{BIMESTRE}}', matchCase: true }, replaceText: meta.bimestre } },
        { replaceAllText: { containsText: { text: '{{DISCIPLINA}}', matchCase: true }, replaceText: meta.disciplina } },
        { replaceAllText: { containsText: { text: '{{TITULO_GABARITO}}', matchCase: true }, replaceText: meta.tituloGabarito } },
      ],
    },
  })

  const { data: document } = await docs.documents.get({ documentId })
  const markerRange = findMarkerRange(document, '{{CORPO_GABARITO}}')
  if (!markerRange) throw new Error('Marcador {{CORPO_GABARITO}} não encontrado no template do Gabarito.')

  const { text, boldRanges } = buildGabaritoBody(exam)
  await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests: buildReplaceMarkerRequests(markerRange, text, boldRanges) },
  })
}
