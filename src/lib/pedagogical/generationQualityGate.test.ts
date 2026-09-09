import { describe, expect, it } from 'vitest'

import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'

import {
  applyBlindPedagogicalReview,
  isPedagogicalQualityGateEnabled,
  type BlindPedagogicalReview,
} from './generationQualityGate'

function question(overrides: Partial<ExamQuestion> = {}): ExamQuestion {
  return {
    number: 1,
    source: 'ia',
    type: 'descritiva',
    bloomLevel: 'analisar',
    statement: 'Compare os dois dados apresentados e justifique qual estratégia reduz mais o desperdício de água.',
    supportText: 'Em janeiro, a turma A reduziu 12% do consumo; a turma B reduziu 8% após intervenções diferentes.',
    alternatives: null,
    correctLetter: null,
    expectedAnswer: 'Relaciona os dois percentuais e justifica a escolha com os dados.',
    gradingCriteria: 'Compara os dados e apresenta justificativa fundamentada.',
    bnccCodes: ['EF07CI01'],
    bnccStatus: 'mapeado',
    bnccSummary: 'Analisa dados de consumo.',
    pedagogicalClassification: {
      dok: { categoryCode: 'DOK_3', confidence: 0.8, justification: 'Integra dados.', evidence: 'Compare os dois dados apresentados' },
      soloExpected: { categoryCode: 'RELACIONAL', confidence: 0.8, justification: 'Relaciona percentuais.', evidence: 'Relaciona os dois percentuais' },
      estimatedTimeMinutes: 5,
      difficulty: 'media',
    },
    saeb: { applicable: false, source: null, value: null, approximate: false },
    needsImage: false,
    imageQuery: null,
    ...overrides,
  }
}

function result(item = question()): ExamGenerationResult {
  return {
    metadata: { segment: 'anos-finais', gradeYear: 7, subject: 'Ciências', questionCount: 1, objectiveCount: 0, discursiveCount: 1, alternativesCount: 5 },
    questions: [item],
  }
}

function review(overrides: Partial<BlindPedagogicalReview['questions'][number]> = {}): BlindPedagogicalReview {
  return {
    questions: [{
      number: 1,
      dok: { categoryCode: 'DOK_3', confidence: 0.84, justification: 'Compara dados e justifica a decisão.', evidenceExcerpt: 'Compare os dois dados apresentados' },
      soloExpected: { categoryCode: 'RELACIONAL', confidence: 0.84, justification: 'Integra os percentuais para concluir.', evidenceExcerpt: 'Relaciona os dois percentuais' },
      ...overrides,
    }],
  }
}

describe('gate de fidelidade pedagógica da geração', () => {
  it('aceita e substitui a justificativa por uma revisão cega com evidência literal', () => {
    const checked = applyBlindPedagogicalReview(result(), review())

    expect(checked.issues).toEqual([])
    expect(checked.corrected.questions[0]?.pedagogicalClassification).toMatchObject({
      dok: { categoryCode: 'DOK_3', confidence: 0.84, evidence: 'Compare os dois dados apresentados' },
      soloExpected: { categoryCode: 'RELACIONAL', confidence: 0.84, evidence: 'Relaciona os dois percentuais' },
    })
  })

  it('adota a revisão cega quando ela diverge do rótulo da geração', () => {
    const checked = applyBlindPedagogicalReview(result(), review({
      dok: { categoryCode: 'DOK_2', confidence: 0.84, justification: 'Procedimento conhecido.', evidenceExcerpt: 'Compare os dois dados apresentados' },
    }))

    expect(checked.issues).toEqual([])
    expect(checked.warnings.join('\n')).toContain('DOK declarado (DOK_3) divergiu da revisão cega (DOK_2)')
    expect(checked.corrected.questions[0]?.pedagogicalClassification.dok.categoryCode).toBe('DOK_2')
  })

  it('rejeita DOK 4 para uma questão isolada e evidência inventada', () => {
    const checked = applyBlindPedagogicalReview(result(), review({
      dok: { categoryCode: 'DOK_4', confidence: 0.9, justification: 'Investigação.', evidenceExcerpt: 'trecho que não existe' },
    }))

    expect(checked.issues.join('\n')).toContain('DOK_4 não é aceito para item isolado')
    expect(checked.issues.join('\n')).toContain('evidência de dok precisa ser um trecho literal')
  })

  it('mantém o gate desativado a menos que a variável seja true', () => {
    expect(isPedagogicalQualityGateEnabled(undefined)).toBe(false)
    expect(isPedagogicalQualityGateEnabled('false')).toBe(false)
    expect(isPedagogicalQualityGateEnabled('true')).toBe(true)
  })
})
