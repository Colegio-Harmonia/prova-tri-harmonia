export type CorrectionAnswer = {
  questionNumber: number
  type: 'objetiva' | 'descritiva'
  transcribedAnswer: string
  correctLetter: string | null // só objetiva, copiado da prova pra comparação visual
  isCorrect: boolean | null // só objetiva, recalculado a cada save
  aiSuggestedGrade: number | null // só descritiva
  /** Nota literal retornada pela IA, antes da normalização. */
  aiSuggestedRawGrade?: number | null
  aiSuggestedGradeScale?: 'question' | '0-10' | null
  aiSuggestedFeedback: string | null // só descritiva
  finalGrade: number | null
  finalFeedback: string | null
  weight?: number
}
