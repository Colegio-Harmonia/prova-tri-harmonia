import { describe, expect, it } from 'vitest'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import type { PlannedQuestionSlot } from './contentPlan'
import { validateExamAssembly } from './examQualityAssembly'

function mathQuestion(number: number, base: number): ExamQuestion {
  return {
    number,
    type: 'objetiva',
    statement: `Considere os dados a seguir. De uma quantidade de ${base} unidades, determine o valor correspondente a 10%.`,
    supportText: null,
    solutionBlueprint: {
      domain: 'percentage', variables: [], equations: [], values: { base, percent: 10 },
      calculationSteps: [], derivedAnswer: String(base / 10), visualSpec: 'none',
    },
  } as unknown as ExamQuestion
}

const slots = [
  { number: 1, type: 'objetiva', unitRowIndex: 1 },
  { number: 2, type: 'objetiva', unitRowIndex: 1 },
] as unknown as PlannedQuestionSlot[]

describe('montagem de questões calculáveis', () => {
  it('aceita templates matemáticos parecidos quando os dados canônicos são diferentes', () => {
    const questions = [
      { ...mathQuestion(1, 200), curriculumUnitRowIndex: 1 },
      { ...mathQuestion(2, 500), curriculumUnitRowIndex: 1 },
    ]
    expect(validateExamAssembly(questions, slots).filter((issue) => issue.severity === 'bloqueante')).toEqual([])
  })

  it('continua bloqueando o mesmo domínio com os mesmos dados', () => {
    const questions = [
      { ...mathQuestion(1, 200), curriculumUnitRowIndex: 1 },
      { ...mathQuestion(2, 200), curriculumUnitRowIndex: 1 },
    ]
    expect(validateExamAssembly(questions, slots).some((issue) => issue.severity === 'bloqueante' && issue.reason.includes('mesmos dados'))).toBe(true)
  })
})
