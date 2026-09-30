import { describe, expect, it } from 'vitest'
import type { CorrectionAnswer } from '@/types/correction'
import { answersWithScanEvidence, hasBlockingScanIssue, isAdvisoryScanPage } from './scanEvidence'
import { totalGrade } from './totalGrade'

const answers: CorrectionAnswer[] = [
  { questionNumber: 1, type: 'objetiva', transcribedAnswer: '', correctLetter: 'B', isCorrect: null, aiSuggestedGrade: null, aiSuggestedFeedback: null, finalGrade: null, finalFeedback: null, weight: 1 },
  { questionNumber: 2, type: 'objetiva', transcribedAnswer: '', correctLetter: 'A', isCorrect: null, aiSuggestedGrade: null, aiSuggestedFeedback: null, finalGrade: null, finalFeedback: null, weight: 1 },
]

describe('scan evidence', () => {
  it('uses completed scan suggestions in the same partial grade shown by the detail screen', () => {
    const page = {
      pageId: 10,
      correctionId: 7,
      sheetAssignmentId: 3,
      sheetPageNumber: 1,
      exceptionCode: 'LOW_QUALITY',
      readings: [
        { questionNumber: 1, kind: 'objective' as const, suggestedLetter: 'B', suggestedTranscription: null, exceptionCode: null },
        { questionNumber: 2, kind: 'objective' as const, suggestedLetter: 'B', suggestedTranscription: null, exceptionCode: null },
      ],
    }
    const merged = answersWithScanEvidence({ id: 7, answers }, [page])

    expect(totalGrade(merged)).toBe(5)
    expect(isAdvisoryScanPage(page)).toBe(true)
    expect(hasBlockingScanIssue(page)).toBe(false)
  })

  it('keeps a real reading exception as blocking', () => {
    const page = {
      correctionId: 7,
      exceptionCode: 'LOW_QUALITY',
      readings: [{ questionNumber: 1, kind: 'objective' as const, suggestedLetter: null, suggestedTranscription: null, exceptionCode: 'MULTIPLE_MARKS' }],
    }

    expect(isAdvisoryScanPage(page)).toBe(false)
    expect(hasBlockingScanIssue(page)).toBe(true)
  })
})
