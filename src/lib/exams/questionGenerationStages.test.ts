import { describe, expect, it } from 'vitest'
import { buildAlignmentRetryFeedback, normalizeJevRubricScore, type QuestionStageContext } from './questionGenerationStages'

const context: QuestionStageContext = {
  questionNumber: 11,
  segment: 'anos-iniciais',
  gradeYear: 4,
  classLabel: '4º ano B',
  subject: 'Matemática',
  questionType: 'objetiva',
  difficulty: 'media',
  curriculumContent: 'Frações e comparação de quantidades.',
  targetSkills: [{ code: 'EF04MA09', description: 'Reconhecer as frações unitárias usuais.', context: ['Matemática', 'Números', 'Frações'], source: 'BNCC oficial', dataVersion: '2026.1' }],
  objectives: ['Comparar frações unitárias.'],
}

describe('normalizeJevRubricScore', () => {
  it('normaliza a rubrica de 0–9 para percentual e rejeita valores fora da escala', () => {
    expect(normalizeJevRubricScore(0)).toBe(0)
    expect(normalizeJevRubricScore(6.3)).toBe(70)
    expect(normalizeJevRubricScore(7)).toBeCloseTo(77.78, 2)
    expect(normalizeJevRubricScore(9)).toBe(100)
    expect(normalizeJevRubricScore(10)).toBeNull()
  })
})

describe('buildAlignmentRetryFeedback', () => {
  it('envia o enunciado completo e um diagnóstico direcionado à BNCC', () => {
    const feedback = buildAlignmentRetryFeedback(
      context,
      { statement: 'Enunciado reprovado completo.', supportText: 'Apoio original completo.' },
      { skillScore: 67.2 },
      ['Aderência BNCC abaixo do mínimo.'],
    )
    expect(feedback).toContain('Enunciado reprovado completo.')
    expect(feedback).toContain('Apoio original completo.')
    expect(feedback).toContain('BNCC 67.2/100')
    expect(feedback).toContain('EF04MA09')
    expect(feedback).toContain('Reconhecer as frações unitárias usuais.')
    expect(feedback).toContain('Frações')
    expect(feedback).not.toContain('adequação à turma')
  })
})
