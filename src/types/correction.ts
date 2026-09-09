export type CorrectionAnswer = {
  questionNumber: number
  type: 'objetiva' | 'descritiva'
  transcribedAnswer: string
  correctLetter: string | null // só objetiva, copiado da prova pra comparação visual
  isCorrect: boolean | null // só objetiva, recalculado a cada save
  aiSuggestedGrade: number | null // só descritiva
  aiSuggestedFeedback: string | null // só descritiva
  finalGrade: number | null
  finalFeedback: string | null
  weight?: number
}
