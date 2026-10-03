import { describe, expect, it } from 'vitest'
import { validateSolutionBlueprint } from '@/lib/math/solutionBlueprint'
import { computeCanonicalDomain } from './domains'
import { assembleExamQuestion, CALCULABLE_GRADING_CRITERIA } from './finalize'
import type { AssembledQuestion, PipelineContext, TruthObject } from './types'

const ctx = (questionType: 'objetiva' | 'descritiva'): PipelineContext => ({
  questionNumber: 4,
  subject: 'Matemática',
  gradeYear: 8,
  segment: 'anos-finais',
  curriculumContent: 'Porcentagem',
  questionType,
})

function calculableTruth(): TruthObject {
  const values = { base: 150, percent: 20 }
  const computation = computeCanonicalDomain('percentage', values)
  return { strategy: 'calculavel', domain: 'percentage', values, derivedAnswer: computation.answer.display, answerNumeric: computation.answer.numeric, derivation: computation.derivation }
}

function assembled(overrides: Partial<AssembledQuestion> = {}): AssembledQuestion {
  return {
    plan: { truthStrategy: 'calculavel', domain: 'percentage' },
    truth: calculableTruth(),
    alternatives: null,
    correctLetter: null,
    visualPlan: { required: false, purpose: 'nenhum', visualType: 'none', rationale: 'sem visual' },
    statement: 'Uma loja vendeu 150 camisetas e 20% delas eram de tamanho G. Quantas camisetas G foram vendidas? Mostre o cálculo.',
    supportText: null,
    expectedAnswer: null,
    gradingCriteria: null,
    metadata: {
      bloomLevel: 'aplicar',
      bnccCodes: ['EF08MA04'],
      bnccStatus: 'mapeado',
      bnccSummary: 'Resolver problemas de porcentagem',
      pedagogicalClassification: {
        dok: { categoryCode: 'DOK_2', confidence: 0.8, justification: 'aplica regra', evidence: 'Quantas camisetas G' },
        soloExpected: { categoryCode: 'MULTIESTRUTURAL', confidence: 0.8, justification: 'etapas', evidence: 'Mostre o cálculo' },
      },
    },
    ...overrides,
  }
}

describe('assembleExamQuestion — descritiva calculável', () => {
  it('sem resposta-modelo da IA, monta a resolução recalculada por código e o resultado final', () => {
    const question = assembleExamQuestion(ctx('descritiva'), assembled())
    expect(question.expectedAnswer).toBe('Resolução: 20% de 150 = 150 × 20 ÷ 100 = 30. Resposta final: 30.')
  })

  it('usa rubrica objetiva por etapas quando a IA não devolve critérios', () => {
    const question = assembleExamQuestion(ctx('descritiva'), assembled())
    expect(question.gradingCriteria).toBe(CALCULABLE_GRADING_CRITERIA)
    expect(question.gradingCriteria).not.toContain('revisão docente')
  })

  it('preserva os critérios próprios da IA quando existem', () => {
    const own = '1) Aplica a razão percentual (50%). 2) Chega a 30 camisetas (50%).'
    const question = assembleExamQuestion(ctx('descritiva'), assembled({ gradingCriteria: own }))
    expect(question.gradingCriteria).toBe(own)
  })

  it('mantém a resposta-modelo da IA (todos os itens) e anexa a conferência recalculada por código', () => {
    const prose = 'a) Calcula 20% de 150 e obtém 30 camisetas. b) Explica que 20% equivale a 20/100.'
    const question = assembleExamQuestion(ctx('descritiva'), assembled({ expectedAnswer: prose }))
    expect(question.expectedAnswer?.startsWith(prose)).toBe(true)
    expect(question.expectedAnswer).toContain('Conferência do cálculo (recalculada por código): 20% de 150 = 150 × 20 ÷ 100 = 30. Resultado: 30.')
  })

  it('continua aprovada pela validação de ficha técnica de Matemática, com ou sem resposta-modelo', () => {
    expect(validateSolutionBlueprint(assembleExamQuestion(ctx('descritiva'), assembled()))).toEqual([])
    const withProse = assembleExamQuestion(ctx('descritiva'), assembled({ expectedAnswer: 'Calcula 20% de 150 e obtém 30 camisetas vendidas do tamanho G.' }))
    expect(validateSolutionBlueprint(withProse)).toEqual([])
  })
})

describe('assembleExamQuestion — demais casos permanecem iguais', () => {
  it('objetiva não ganha resposta esperada nem critérios', () => {
    const question = assembleExamQuestion(ctx('objetiva'), assembled({
      alternatives: [{ letter: 'A', text: '30' }, { letter: 'B', text: '20' }, { letter: 'C', text: '15' }, { letter: 'D', text: '40' }, { letter: 'E', text: '25' }],
      correctLetter: 'A',
    }))
    expect(question.expectedAnswer).toBeNull()
    expect(question.gradingCriteria).toBeNull()
  })

  it('descritiva ancorada mantém a resposta-modelo da IA e o texto padrão de critérios', () => {
    const question = assembleExamQuestion(ctx('descritiva'), {
      ...assembled({ expectedAnswer: 'A fotossíntese converte luz em energia química armazenada na glicose.' }),
      plan: { truthStrategy: 'fonte_ancorada', sourceMaterial: 'Fotossíntese' },
      truth: { strategy: 'fonte_ancorada', values: {}, derivation: 'x', claim: 'A fotossíntese produz glicose.' },
    })
    expect(question.expectedAnswer).toBe('A fotossíntese converte luz em energia química armazenada na glicose.')
    expect(question.gradingCriteria).toBe('Critérios definidos na revisão docente.')
    expect(question.solutionBlueprint).toBeNull()
  })
})
