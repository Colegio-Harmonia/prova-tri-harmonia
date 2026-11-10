import type { ExamQuestion } from '@/lib/gemini/examSchema'

export type OriginalAcervoMedia = { id: number; local: string; texto_alternativo?: string | null }
export type AcervoContentPart = NonNullable<NonNullable<ExamQuestion['acervoInlineContent']>['statement']>[number]

export function inlineAcervoMediaIds(question: ExamQuestion): number[] {
  const parts = [...(question.acervoInlineContent?.statement ?? []), ...Object.values(question.acervoInlineContent?.alternatives ?? {}).flat()]
  const allowedIds = new Set(originalAcervoMedia(question).filter((media) => ['enunciado', 'alternativa'].includes(media.local)).map((media) => media.id))
  return parts.flatMap((part) => part.type === 'image' && allowedIds.has(part.mediaId) ? [part.mediaId] : [])
}

export function hasOnlyInlineAcervoMedia(question: ExamQuestion): boolean {
  const originals = originalAcervoMedia(question).filter((media) => ['enunciado', 'alternativa'].includes(media.local))
  const inline = new Set(inlineAcervoMediaIds(question))
  return originals.length > 0 && originals.every((media) => inline.has(media.id))
}

/** Keep answer media separate from the student's statement and support image. */
export function originalAcervoMedia(question: ExamQuestion, location?: string): OriginalAcervoMedia[] {
  if (question.source !== 'acervo' || !Array.isArray(question.acervoRef?.original.midias)) return []
  return question.acervoRef.original.midias.filter((value): value is OriginalAcervoMedia => {
    if (!value || typeof value !== 'object') return false
    const media = value as Record<string, unknown>
    return typeof media.id === 'number' && Number.isSafeInteger(media.id) && media.id > 0
      && typeof media.local === 'string' && (!location || media.local === location)
  })
}

export function originalAcervoMediaUrl(examId: number, mediaId: number): string {
  return `/api/exams/${examId}/acervo-media/${mediaId}`
}
