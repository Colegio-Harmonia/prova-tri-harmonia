import { normalizeCorrectionAnswers } from './normalizeCorrectionAnswers'

export type ScanEvidenceReading = {
  questionNumber: number
  kind: 'objective' | 'discursive'
  suggestedLetter: string | null
  confirmedLetter?: string | null
  suggestedTranscription: string | null
  confirmedTranscription?: string | null
  exceptionCode?: string | null
}

export type ScanEvidencePage = {
  pageId?: number
  correctionId: number | null
  sheetAssignmentId?: number | null
  sheetPageNumber?: number | null
  status?: string | null
  exceptionCode?: string | null
  readings?: ScanEvidenceReading[]
  createdAt?: string | Date | null
}

/**
 * LOW_QUALITY is advisory when the reader produced every expected reading.
 * The teacher may still inspect the image, but the scan is not operationally
 * blocked and should not be presented as a failed reading.
 */
export function hasCompleteScanReadings(page: ScanEvidencePage) {
  const readings = page.readings ?? []
  return readings.length > 0 && readings.every((reading) => !reading.exceptionCode)
}

export function isAdvisoryScanPage(page: ScanEvidencePage) {
  return page.exceptionCode === 'LOW_QUALITY' && hasCompleteScanReadings(page)
}

export function hasBlockingScanIssue(page: ScanEvidencePage) {
  return Boolean(page.exceptionCode) && !isAdvisoryScanPage(page)
}

function pageTimestamp(page: ScanEvidencePage) {
  const timestamp = page.createdAt ? new Date(page.createdAt).getTime() : 0
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function latestScanPagesForCorrection(pages: ScanEvidencePage[], correctionId: number) {
  const latest = new Map<string, ScanEvidencePage>()
  pages
    .filter((page) => page.correctionId === correctionId)
    .sort((left, right) => pageTimestamp(left) - pageTimestamp(right))
    .forEach((page) => {
      const key = page.sheetAssignmentId !== null && page.sheetAssignmentId !== undefined && page.sheetPageNumber !== null && page.sheetPageNumber !== undefined
        ? `${page.sheetAssignmentId}:${page.sheetPageNumber}`
        : `page:${page.pageId ?? pageTimestamp(page)}`
      latest.set(key, page)
    })
  return [...latest.values()]
}

/** Applies the same scan suggestions that the student review screen previews. */
export function answersWithScanEvidence(
  correction: { id: number; answers: unknown },
  pages: ScanEvidencePage[],
  questionWeights?: Map<number, number>,
) {
  const readingsByQuestion = new Map<number, ScanEvidenceReading>()
  for (const page of latestScanPagesForCorrection(pages, correction.id)) {
    for (const reading of page.readings ?? []) readingsByQuestion.set(reading.questionNumber, reading)
  }

  return normalizeCorrectionAnswers(correction.answers).map((answer) => {
    if (answer.transcribedAnswer.trim()) return answer
    const reading = readingsByQuestion.get(answer.questionNumber)
    if (!reading) return answer

    if (answer.type === 'objetiva') {
      const letter = (reading.confirmedLetter ?? reading.suggestedLetter ?? '').trim().toUpperCase()
      if (!/^[A-E]$/.test(letter)) return answer
      const weight = questionWeights?.get(answer.questionNumber) ?? answer.weight ?? 1
      return {
        ...answer,
        weight: answer.weight ?? weight,
        transcribedAnswer: letter,
        isCorrect: letter === (answer.correctLetter ?? '').trim().toUpperCase(),
        finalGrade: letter === (answer.correctLetter ?? '').trim().toUpperCase() ? weight : 0,
      }
    }

    const transcription = (reading.confirmedTranscription ?? reading.suggestedTranscription ?? '').trim()
    return transcription ? { ...answer, transcribedAnswer: transcription } : answer
  })
}
