import type { CorrectionAnswer } from '@/types/correction'
import { questionMaxGrade } from './gradeNormalization'

// Nota ponderada sobre TODAS as questões (não só as já corrigidas) — uma
// questão sem correção ainda conta como divisor, então a nota só reflete
// o total real quando a correção está completa. Mesma lógica usada tanto
// na tela (preview) quanto no servidor (decidir o que vai pro Classroom) —
// nunca duplicar esse cálculo, as duas pontas têm que bater exatamente.
export function totalGrade(answers: CorrectionAnswer[]): number | null {
  // Há registros legados em que o JSON de respostas foi persistido como
  // objeto. A tela de correção não deve cair por causa desses dados: até a
  // correção ser reparada, trate-a como sem respostas avaliadas.
  const safeAnswers = Array.isArray(answers) ? answers : []
  const graded = safeAnswers.filter((a) => a.type === 'objetiva' ? a.isCorrect !== null : a.finalGrade !== null)
  if (graded.length === 0) return null
  const totalWeight = safeAnswers.reduce((sum, answer) => sum + questionMaxGrade(answer), 0)
  const earned = safeAnswers.reduce((sum, answer) => {
    const maximum = questionMaxGrade(answer)
    if (answer.type === 'objetiva') return sum + (answer.isCorrect === true ? maximum : 0)
    return sum + Math.min(Math.max(answer.finalGrade ?? 0, 0), maximum)
  }, 0)
  return Math.round((earned / totalWeight) * 100) / 10
}

/** Converte a nota de uma questão para a escala comparável 0–10. */
export function answerGradeOnTen(answer: CorrectionAnswer): number | null {
  if (answer.type === 'objetiva') {
    return answer.isCorrect === null ? null : answer.isCorrect ? 10 : 0
  }
  if (answer.finalGrade === null) return null
  const weight = questionMaxGrade(answer)
  return Math.min(weight, Math.max(0, answer.finalGrade)) / weight * 10
}
