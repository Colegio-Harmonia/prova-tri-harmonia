import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import type { CorrectionAnswer } from '@/types/correction'

export function buildEmptyAnswers(payload: ExamGenerationResult): CorrectionAnswer[] {
  return payload.questions.map((q) => ({
    questionNumber: q.number,
    type: q.type,
    transcribedAnswer: '',
    correctLetter: q.type === 'objetiva' ? (q.correctLetter ?? null) : null,
    isCorrect: null,
    aiSuggestedGrade: null,
    aiSuggestedFeedback: null,
    finalGrade: null,
    finalFeedback: null,
  }))
}
