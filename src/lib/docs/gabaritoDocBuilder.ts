import type { docs_v1 } from 'googleapis'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { findMarkerRange, type TextRange } from './richTextInsert'
import type { AssessmentMeta } from './assessmentMeta'
import { textToOps, buildOpsRequests } from './provaDocBuilder'
import { buildLatexImageCache } from './latexImageCache'
import { presentAcervoExam } from '@/lib/exams/acervoPresentation'
import { originalAcervoMedia } from '@/lib/exams/acervoMedia'
import { buildAcervoImageCache } from './acervoImageCache'
import type { LatexImageCache, LatexImageInfo } from './latexImageCache'

export function buildGabaritoBody(exam: ExamGenerationResult): { text: string; boldRanges: TextRange[]; imageAnchors: Array<{ at: number; mediaId: number }> } {
  exam = presentAcervoExam(exam)
  let text = ''
  const boldRanges: TextRange[] = []
  const imageAnchors: Array<{ at: number; mediaId: number }> = []

  for (const q of exam.questions) {
    const appendOriginalImages = () => {
      for (const media of originalAcervoMedia(q, 'resolucao')) {
        imageAnchors.push({ at: text.length, mediaId: media.id })
        text += '\n'
      }
    }
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
        const plain = q.commentedResolution.replace(/\*\*|__|^#+\s*/gm, '')
        text += `   Resolução comentada: ${plain}\n\n`
      }
      appendOriginalImages()
    } else {
      text += `Resposta esperada: ${q.expectedAnswer?.trim() ? q.expectedAnswer : 'NÃO CADASTRADA — definir antes de corrigir'}\n`
      appendOriginalImages()
      text += `   Critérios de correção: ${(q.gradingCriteria ?? '—')}\n`
    }
  }

  return { text, boldRanges, imageAnchors }
}

export function buildGabaritoOps(exam: ExamGenerationResult, latexCache: LatexImageCache, resolutionImages: Map<number, LatexImageInfo>): ReturnType<typeof textToOps> {
  const { text, boldRanges, imageAnchors } = buildGabaritoBody(exam)
  const boundaries = [...new Set([0, text.length, ...boldRanges.flatMap((range) => [range.start, range.end]), ...imageAnchors.map((anchor) => anchor.at)])].sort((a, b) => a - b)
  const ops: ReturnType<typeof textToOps> = []
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index]!
    const end = boundaries[index + 1]!
    for (const anchor of imageAnchors.filter((entry) => entry.at === start)) {
      const image = resolutionImages.get(anchor.mediaId)
      if (image) ops.push({ kind: 'image', driveFileId: image.driveFileId, size: { widthPt: image.widthPt, heightPt: image.heightPt } })
      else ops.push({ kind: 'text', text: 'Imagem da resolução original indisponível.' })
    }
    ops.push(...textToOps(text.slice(start, end), latexCache, boldRanges.some((range) => start >= range.start && start < range.end)))
  }
  return ops
}

export async function applyGabaritoContent(
  docs: docs_v1.Docs,
  documentId: string,
  exam: ExamGenerationResult,
  meta: AssessmentMeta,
): Promise<void> {
  exam = presentAcervoExam(exam)
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

  const [cache, resolutionImages] = await Promise.all([buildLatexImageCache(exam), buildAcervoImageCache(exam, 'resolucao')])
  const ops = buildGabaritoOps(exam, cache, resolutionImages)
  await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests: [
      { deleteContentRange: { range: { startIndex: markerRange.start, endIndex: markerRange.end } } },
      ...buildOpsRequests(ops, markerRange.start),
    ] },
  })
}
