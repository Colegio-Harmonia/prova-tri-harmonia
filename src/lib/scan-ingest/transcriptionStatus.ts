import type { CorrectionAnswer } from '@/types/correction'
import { normalizeCorrectionAnswers } from '@/lib/corrections/normalizeCorrectionAnswers'

export const ACTIVE_TRANSCRIPTION_CODES = new Set([
  'OCR_QUEUED',
  'OCR_PROCESSING',
  'OCR_DEFERRED',
  'AI_BUDGET_DEFERRED',
])

export type TranscriptionPage = {
  id: number
  sheetPageNumber: number | null
  status?: string | null
  exceptionCode?: string | null
  canonicalDriveFileId?: string | null
  createdAt?: Date | null
}

export type TranscriptionReading = {
  pageId: number
  questionNumber: number
  suggestedTranscription: string | null
  confirmedTranscription?: string | null
  exceptionCode: string | null
  reviewStatus?: string | null
  updatedAt?: Date | null
}

export type TranscriptionJob = {
  pageId: number
  questionNumbers: number[]
  status: 'pendente' | 'gerando'
  availableAt?: Date | null
}

export type TranscriptionSummary = {
  total: number
  completed: number
  queued: number
  processing: number
  deferred: number
  needsReview: number
  failed: number
  active: number
  canApprove: boolean
  lastUpdatedAt: string | null
}

export function isTranscriptionActive(reading: Pick<TranscriptionReading, 'suggestedTranscription' | 'exceptionCode' | 'reviewStatus'> | null | undefined) {
  if (!reading) return false
  if (reading.suggestedTranscription?.trim()) return false
  if (reading.reviewStatus === 'accepted' || reading.reviewStatus === 'rejected') return false
  // A reading without an exception code is only pending/unclassified. It is
  // not evidence that a worker claimed a transcription job. Treating it as
  // active makes the automatic queue skip fresh scan readings forever.
  return ACTIVE_TRANSCRIPTION_CODES.has(reading.exceptionCode ?? '')
}

export function isTranscriptionCompleted(reading: Pick<TranscriptionReading, 'suggestedTranscription' | 'confirmedTranscription'> | null | undefined) {
  return Boolean(reading?.confirmedTranscription?.trim() || reading?.suggestedTranscription?.trim())
}

/**
 * Keeps the page chosen for transcription deterministic when a scan retry or
 * a foreign sheet created another page with the same sheet number.
 */
export function latestRelevantTranscriptionPages<T extends TranscriptionPage>(pages: T[], keyForPage: (page: T) => string | null) {
  const current = new Map<string, T>()
  const ordered = [...pages]
    .filter((page) => page.exceptionCode !== 'SCAN_BELONGS_TO_ANOTHER_EXAM')
    .sort((left, right) => {
      const leftPriority = left.status === 'processed' && !left.exceptionCode ? 0 : 1
      const rightPriority = right.status === 'processed' && !right.exceptionCode ? 0 : 1
      if (leftPriority !== rightPriority) return leftPriority - rightPriority
      const leftTime = left.createdAt?.getTime() ?? 0
      const rightTime = right.createdAt?.getTime() ?? 0
      return rightTime - leftTime
    })
  for (const page of ordered) {
    const key = keyForPage(page)
    if (key !== null && !current.has(key)) current.set(key, page)
  }
  return [...current.values()]
}

/** Returns the physical sheet page from the complete print plan. Objective
 * pages count too; filtering the plan before finding the index shifts every
 * later discursive page. */
export function sheetPageNumberForQuestion(plan: Array<{ questions: Array<{ number: number }> }>, questionNumber: number) {
  const index = plan.findIndex((page) => page.questions.some((question) => question.number === questionNumber))
  return index < 0 ? null : index + 1
}

export function summarizeTranscriptions(input: {
  answers: unknown
  discursiveQuestionNumbers: Set<number>
  pages: TranscriptionPage[]
  readings: TranscriptionReading[]
  pageForQuestion: Map<number, TranscriptionPage | undefined>
  activeJobs?: TranscriptionJob[]
}): TranscriptionSummary {
  const readingsByKey = new Map(input.readings.map((reading) => [`${reading.pageId}:${reading.questionNumber}`, reading]))
  const summaries = normalizeCorrectionAnswers(input.answers).filter((answer) => answer.type === 'descritiva' && input.discursiveQuestionNumbers.has(answer.questionNumber))

  let total = 0
  let completed = 0
  let queued = 0
  let processing = 0
  let deferred = 0
  let needsReview = 0
  let failed = 0
  let lastUpdatedAt: Date | null = null

  for (const answer of summaries) {
    const page = input.pageForQuestion.get(answer.questionNumber)
    if (!page) continue
    total += 1
    const reading = readingsByKey.get(`${page.id}:${answer.questionNumber}`)
    const code = reading?.exceptionCode ?? ''
    const activeJob = input.activeJobs?.find((candidate) => candidate.pageId === page.id && (candidate.questionNumbers.length === 0 || candidate.questionNumbers.includes(answer.questionNumber)))
    if (reading && isTranscriptionCompleted(reading)) {
      completed += 1
    } else if (reading?.reviewStatus === 'accepted' || reading?.reviewStatus === 'rejected') {
      // Uma revisão manual encerra a pendência mesmo quando a resposta foi
      // confirmada como vazia. A aprovação ainda exige a nota final, validada
      // separadamente pelo fluxo de correção.
      completed += 1
    } else if (!reading && answer.transcribedAnswer.trim()) {
      completed += 1
    } else {
      if (activeJob) {
        if (activeJob.availableAt && activeJob.availableAt.getTime() > Date.now()) deferred += 1
        else if (activeJob.status === 'gerando') processing += 1
        else queued += 1
      } else if (code === 'OCR_UNREADABLE' || code === 'OCR_MISSING_RESULT' || code.startsWith('OCR_') || code.startsWith('provider_') || code === 'rate_limited' || isTranscriptionActive(reading) || !reading) {
        if (answer.transcribedAnswer.trim()) completed += 1
        else { failed += 1; needsReview += 1 }
      } else if (answer.transcribedAnswer.trim()) {
        completed += 1
      } else {
        needsReview += 1
      }
    }
    if (reading) {
      const updatedAt = (reading as TranscriptionReading & { updatedAt?: Date | null }).updatedAt
      if (updatedAt && (!lastUpdatedAt || updatedAt > lastUpdatedAt)) lastUpdatedAt = updatedAt
    }
  }

  const active = queued + processing + deferred
  return {
    total,
    completed,
    queued,
    processing,
    deferred,
    needsReview,
    failed,
    active,
    canApprove: active === 0 && needsReview === 0,
    lastUpdatedAt: lastUpdatedAt?.toISOString() ?? null,
  }
}
