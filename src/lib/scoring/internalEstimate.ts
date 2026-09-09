import type { CorrectionAnswer } from '@/types/correction'

// Indicador interno para itens autorais/IA. Não é TRI, não usa parâmetros
// INEP e nunca compõe a nota TRI. A ponderação vem apenas da dificuldade
// pedagógica declarada na revisão ou geração da questão.
export type InternalEstimate = {
  percent: number
  itemsUsed: number
  incompleteAnswers: number
  method: 'editorial_difficulty_weighted'
}

export type InternalEstimateQuestion = {
  number: number
  source?: string
  difficulty?: 'facil' | 'media' | 'adequada' | 'dificil' | null
}

const WEIGHT_BY_DIFFICULTY = {
  facil: 0.9,
  media: 1,
  adequada: 1,
  dificil: 1.1,
} as const

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export function buildInternalEstimate(
  answers: CorrectionAnswer[],
  questions: InternalEstimateQuestion[],
): InternalEstimate | null {
  const byNumber = new Map(
    questions
      .filter((question) => question.source !== 'enem_bank')
      .map((question) => [question.number, question]),
  )

  let weightedPoints = 0
  let totalWeight = 0
  let itemsUsed = 0
  let incompleteAnswers = 0

  for (const answer of answers) {
    const question = byNumber.get(answer.questionNumber)
    if (!question) continue

    const weight = WEIGHT_BY_DIFFICULTY[question.difficulty ?? 'media']
    totalWeight += weight
    itemsUsed++

    if (answer.type === 'objetiva') {
      if (answer.isCorrect === null) incompleteAnswers++
      else if (answer.isCorrect) weightedPoints += weight
    } else if (answer.finalGrade === null) {
      incompleteAnswers++
    } else {
      weightedPoints += weight * Math.min(10, Math.max(0, answer.finalGrade)) / 10
    }
  }

  if (!itemsUsed || !totalWeight) return null
  return {
    percent: round((weightedPoints / totalWeight) * 100, 1),
    itemsUsed,
    incompleteAnswers,
    method: 'editorial_difficulty_weighted',
  }
}
