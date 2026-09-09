import { describe, expect, it } from 'vitest'

import type { CurriculumSelection } from '@/types/exam'

import { buildSingleQuestionPrompt } from './promptBuilder'

const curriculum: CurriculumSelection = {
  segment: 'anos-finais',
  gradeYear: 7,
  subject: 'Ciências',
  bimester: 3,
  tabName: 'Ciências 7º ano',
  units: [],
  unmappedWarnings: [],
}

describe('prompt de substituição de questão', () => {
  it('pede o número real da questão em vez de um identificador provisório', async () => {
    const prompt = await buildSingleQuestionPrompt(curriculum, {
      type: 'descritiva',
      questionNumber: 8,
      avoidStatement: 'Explique a diferença entre atrito estático e cinético.',
    })

    expect(prompt).toContain('"number" exatamente igual a 8')
    expect(prompt).not.toContain('"number" igual a 0')
  })
})
