import { describe, expect, it } from 'vitest'
import type { CorrectionAnswer } from '@/types/correction'
import { scoringMethodForQuestions, TRI_MIN_CALIBRATED_COVERAGE } from './scoringPolicy'
import { scorePercentual } from './percentualScorer'
import { buildTriEstimate, estimateThetaEap, probability3pl, thetaToEnemScale, type TriItem } from './triScorer'

function objetiva(n: number, isCorrect: boolean | null): CorrectionAnswer {
  return {
    questionNumber: n,
    type: 'objetiva',
    transcribedAnswer: isCorrect === null ? '' : 'A',
    correctLetter: 'A',
    isCorrect,
    aiSuggestedGrade: null,
    aiSuggestedFeedback: null,
    finalGrade: isCorrect === null ? null : isCorrect ? 10 : 0,
    finalFeedback: null,
  }
}

function descritiva(n: number, finalGrade: number | null): CorrectionAnswer {
  return {
    questionNumber: n,
    type: 'descritiva',
    transcribedAnswer: 'resposta',
    correctLetter: null,
    isCorrect: null,
    aiSuggestedGrade: null,
    aiSuggestedFeedback: null,
    finalGrade,
    finalFeedback: null,
  }
}

describe('scoringMethodForQuestions', () => {
  it('usa TRI INEP somente quando há item objetivo do banco ENEM', () => {
    expect(scoringMethodForQuestions([{ type: 'objetiva', source: 'ia' }])).toBe('percentual')
    expect(scoringMethodForQuestions([{ type: 'descritiva', source: 'enem_bank' }])).toBe('percentual')
    expect(scoringMethodForQuestions([{ type: 'objetiva', source: 'enem_bank' }, { type: 'objetiva', source: 'ia' }])).toBe('tri')
  })
})

describe('scorePercentual', () => {
  it('objetiva vale 10/0, descritiva usa a nota final, peso igual', () => {
    // (10 + 0 + 7) / 30 = 56.7%
    const result = scorePercentual([objetiva(1, true), objetiva(2, false), descritiva(3, 7)])
    expect(result.method).toBe('percentual')
    expect(result.percent).toBe(56.7)
    expect(result.decimal).toBe(5.67)
    expect(result.objectiveTotal).toBe(2)
    expect(result.objectiveCorrect).toBe(1)
    expect(result.incompleteAnswers).toBe(0)
  })

  it('resposta sem correção fechada conta 0 e é sinalizada, não ignorada', () => {
    const result = scorePercentual([objetiva(1, true), objetiva(2, null), descritiva(3, null)])
    expect(result.percent).toBe(33.3)
    expect(result.incompleteAnswers).toBe(2)
  })

  it('nota descritiva é limitada a 0-10', () => {
    const result = scorePercentual([descritiva(1, 15)])
    expect(result.percent).toBe(100)
  })

  it('prova sem respostas dá 0 sem dividir por zero', () => {
    expect(scorePercentual([]).percent).toBe(0)
  })
})

describe('probability3pl', () => {
  it('em theta = b, a probabilidade é c + (1-c)/2', () => {
    const p = probability3pl(0.5, { a: 1.2, b: 0.5, c: 0.2 })
    expect(p).toBeCloseTo(0.2 + 0.8 / 2, 10)
  })

  it('acerto casual (c) é o piso da curva', () => {
    const p = probability3pl(-4, { a: 2, b: 2, c: 0.25 })
    expect(p).toBeGreaterThan(0.25)
    expect(p).toBeLessThan(0.26)
  })
})

describe('estimateThetaEap', () => {
  const items = (correct: boolean): TriItem[] =>
    Array.from({ length: 10 }, (_, i) => ({ a: 1.2, b: (i - 5) / 3, c: 0.2, correct }))

  it('gabaritar puxa theta bem acima de zero; zerar, bem abaixo', () => {
    const high = estimateThetaEap(items(true))
    const low = estimateThetaEap(items(false))
    expect(high.theta).toBeGreaterThan(1)
    expect(low.theta).toBeLessThan(-1)
    expect(high.theta).toBeGreaterThan(low.theta)
  })

  it('mais itens reduzem o erro-padrão da estimativa', () => {
    const few = estimateThetaEap(items(true).slice(0, 3))
    const many = estimateThetaEap(items(true))
    expect(many.sem).toBeLessThan(few.sem)
  })
})

describe('thetaToEnemScale', () => {
  it('500 + 100*theta, truncado a [0, 1000]', () => {
    expect(thetaToEnemScale(0)).toBe(500)
    expect(thetaToEnemScale(1.5)).toBe(650)
    expect(thetaToEnemScale(-10)).toBe(0)
    expect(thetaToEnemScale(10)).toBe(1000)
  })
})

describe('buildTriEstimate', () => {
  const calibrated = (n: number): TriItem[] =>
    Array.from({ length: n }, (_, i) => ({ a: 1.0, b: (i % 5) / 2 - 1, c: 0.2, correct: i % 2 === 0 }))

  it('zero itens calibrados = sem TRI (null), nunca score 0', () => {
    expect(buildTriEstimate([], 12)).toBeNull()
  })

  it(`cobertura abaixo de ${TRI_MIN_CALIBRATED_COVERAGE * 100}% marca a estimativa como aproximada`, () => {
    const estimate = buildTriEstimate(calibrated(5), 10)
    expect(estimate).not.toBeNull()
    expect(estimate!.approximate).toBe(true)
    expect(estimate!.itemsUsed).toBe(5)
    expect(estimate!.itemsTotal).toBe(10)
  })

  it('cobertura suficiente sai sem ressalva e com score na escala', () => {
    const estimate = buildTriEstimate(calibrated(8), 10)
    expect(estimate!.approximate).toBe(false)
    expect(estimate!.score).toBeGreaterThanOrEqual(0)
    expect(estimate!.score).toBeLessThanOrEqual(1000)
  })
})
