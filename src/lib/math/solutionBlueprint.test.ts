import { describe, expect, it } from 'vitest'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { validateSolutionBlueprint } from './solutionBlueprint'

function systemQuestion(correctLetter = 'A'): ExamQuestion {
  return {
    number: 9, source: 'ia', type: 'objetiva', bloomLevel: 'analisar', statement: 'Resolva o sistema.', supportText: null,
    alternatives: [{ letter: 'A', text: '(0, 30)' }, { letter: 'B', text: '(10, 20)' }], correctLetter, expectedAnswer: null, gradingCriteria: null,
    solutionBlueprint: {
      domain: 'linear_system', variables: [{ symbol: 'x', meaning: 'rota A' }, { symbol: 'y', meaning: 'rota B' }],
      equations: ['x+y=30', '2x+3y=60'], values: {}, calculationSteps: ['Elimine x.', 'y=30 e x=0.'], derivedAnswer: 'x=0; y=30; ponto (0, 30).', visualSpec: 'blank_coordinate_plane',
    },
    bnccCodes: [], bnccStatus: 'nao_mapeado', bnccSummary: null,
    pedagogicalClassification: { dok: { categoryCode: 'DOK_2', confidence: 1, justification: 'teste', evidence: 'teste' }, soloExpected: { categoryCode: 'RELACIONAL', confidence: 1, justification: 'teste', evidence: 'teste' } },
    saeb: { applicable: false, source: null, value: null, approximate: false }, needsImage: true, imageQuery: 'plano cartesiano', image: null, review: null,
  }
}

describe('solutionBlueprint', () => {
  it('confere o sistema linear e a alternativa derivada', () => {
    expect(validateSolutionBlueprint(systemQuestion())).toEqual([])
  })

  it('bloqueia gabarito que não corresponde à solução calculada', () => {
    expect(validateSolutionBlueprint(systemQuestion('B')).join(' ')).toContain('alternativa marcada no gabarito')
  })

  it('confere volume de paralelepípedo e conversão para litros', () => {
    const question = { ...systemQuestion(), type: 'descritiva' as const, alternatives: null, correctLetter: null, expectedAnswer: '2400 litros', gradingCriteria: 'Aceita o cálculo do volume e a conversão.', solutionBlueprint: { domain: 'rectangular_prism_volume' as const, variables: [], equations: [], values: { length: 2.5, width: 1.2, height: 0.8, unitFactor: 1000 }, calculationSteps: ['2,5 × 1,2 × 0,8 = 2,4 m³.', '2,4 m³ = 2400 litros.'], derivedAnswer: '2400 litros', visualSpec: 'none' as const } }
    expect(validateSolutionBlueprint(question)).toEqual([])
  })
})
