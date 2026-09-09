import type { CorrectionAnswer } from '@/types/correction'
import type { PercentualBreakdown, PercentualScore } from './scoringPolicy'

// Pontuação percentual (spec seção 1.3) — formaliza o que a correção e o
// /desempenho já fazem: objetiva vale 10/0 contra o gabarito
// (determinístico), descritiva usa a nota final revisada (0-10), peso
// igual por questão. Percentual = média / 10.

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export function buildPercentualBreakdown(answers: CorrectionAnswer[]): PercentualBreakdown {
  let sum = 0
  let objectiveTotal = 0
  let objectiveCorrect = 0
  let incompleteAnswers = 0

  for (const answer of answers) {
    if (answer.type === 'objetiva') {
      objectiveTotal++
      if (answer.isCorrect === null) incompleteAnswers++
      else if (answer.isCorrect) {
        objectiveCorrect++
        sum += 10
      }
    } else {
      if (answer.finalGrade === null) incompleteAnswers++
      else sum += Math.min(10, Math.max(0, answer.finalGrade))
    }
  }

  const percent = answers.length ? round((sum / (answers.length * 10)) * 100, 1) : 0

  return {
    percent,
    decimal: round(percent / 10, 2),
    gradedQuestions: answers.length,
    objectiveTotal,
    objectiveCorrect,
    incompleteAnswers,
  }
}

export function scorePercentual(answers: CorrectionAnswer[]): PercentualScore {
  return { method: 'percentual', ...buildPercentualBreakdown(answers) }
}
