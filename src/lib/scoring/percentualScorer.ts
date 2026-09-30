import type { CorrectionAnswer } from '@/types/correction'
import { questionMaxGrade } from '@/lib/corrections/gradeNormalization'
import type { PercentualBreakdown, PercentualScore } from './scoringPolicy'

// Pontuação percentual (spec seção 1.3): cada questão contribui com seu
// máximo de pontos. Quando o peso não existe (provas antigas), o padrão é
// 1 ponto; isso mantém objetiva e descritiva na mesma escala. Percentual é
// a razão entre pontos obtidos e pontos possíveis.

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export function buildPercentualBreakdown(answers: CorrectionAnswer[]): PercentualBreakdown {
  let sum = 0
  let objectiveTotal = 0
  let objectiveCorrect = 0
  let incompleteAnswers = 0
  let totalWeight = 0

  for (const answer of answers) {
    const maximum = questionMaxGrade(answer)
    totalWeight += maximum
    if (answer.type === 'objetiva') {
      objectiveTotal++
      if (answer.isCorrect === null) incompleteAnswers++
      else if (answer.isCorrect) {
        objectiveCorrect++
        sum += maximum
      }
    } else {
      if (answer.finalGrade === null) incompleteAnswers++
      else sum += Math.min(maximum, Math.max(0, answer.finalGrade))
    }
  }

  const percent = totalWeight ? round((sum / totalWeight) * 100, 1) : 0

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
