import { describe, expect, it } from 'vitest'
import type { ExamQuestion } from './examSchema'
import { correctSingleQuestion } from './examValidator'

function question(overrides: Partial<ExamQuestion> = {}): ExamQuestion {
  return {
    number: 5, source: 'ia', type: 'objetiva', bloomLevel: 'compreender',
    statement: 'Qual estratégia representa o uso de mosaicos ecológicos?',
    supportText: 'Mosaicos ecológicos são conjuntos de unidades de conservação próximas.',
    alternatives: [{ letter: 'A', text: 'Uma unidade isolada.' }, { letter: 'B', text: 'Unidades próximas e interligadas.' }, { letter: 'C', text: 'Expansão urbana.' }, { letter: 'D', text: 'Caça controlada.' }, { letter: 'E', text: 'Plantações comerciais.' }],
    correctLetter: 'B', expectedAnswer: null, gradingCriteria: null, bnccCodes: [], bnccStatus: 'mapeado', bnccSummary: null,
    pedagogicalClassification: { dok: { categoryCode: 'DOK_1', confidence: 1, justification: 'teste', evidence: 'teste' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 1, justification: 'teste', evidence: 'teste' } },
    saeb: { applicable: false, source: null, value: null, approximate: false }, needsImage: false, imageQuery: null, image: null, review: null,
    ...overrides,
  }
}

describe('correctSingleQuestion', () => {
  const curriculum = { segment: 'anos-finais' as const, gradeYear: 9, subject: 'Ciências' }
  it('remove texto de apoio que define o conceito cobrado', () => { const result = correctSingleQuestion(question(), curriculum); expect(result.question.supportText).toBeNull(); expect(result.warnings).toContain('Questão 5: texto de apoio definia o conceito cobrado e foi removido para não entregar a resposta.') })
  it('preserva evidência que não define o conceito da pergunta', () => { const result = correctSingleQuestion(question({ supportText: 'Em uma área fragmentada, foram registradas três populações isoladas de mamíferos.' }), curriculum); expect(result.question.supportText).toContain('três populações isoladas') })
  it('normaliza LaTeX solto para que seja renderizado', () => { const result = correctSingleQuestion(question({ statement: 'O ponto C é (1,\\sqrt{8}).' }), curriculum); expect(result.question.statement).toBe('O ponto C é (1,$\\sqrt{8}$).'); expect(result.issues).toEqual([]) })
  it('rejeita texto corrompido para acionar uma nova geração', () => { const result = correctSingleQuestion(question({ statement: 'A relev\u0002ncia é importante.' }), curriculum); expect(result.issues.join(' ')).toContain('caracteres de controle') })
  it('remove descritor SAEB do campo BNCC (D26 não é BNCC)', () => { const result = correctSingleQuestion(question({ bnccCodes: ['D26'], bnccStatus: 'mapeado' }), curriculum); expect(result.question.bnccCodes).toEqual([]); expect(result.question.bnccStatus).toBe('nao_mapeado'); expect(result.warnings.join(' ')).toContain('não são BNCC') })
  it('mantém código BNCC no formato oficial', () => { const result = correctSingleQuestion(question({ bnccCodes: ['EF09CI01'], bnccStatus: 'mapeado' }), curriculum); expect(result.question.bnccCodes).toEqual(['EF09CI01']); expect(result.question.bnccStatus).toBe('mapeado') })
  it('mantém ficha matemática incompleta como pendência de revisão no fluxo planejado', () => {
    const result = correctSingleQuestion(question({ statement: 'Resolva o sistema.', supportText: null, solutionBlueprint: { domain: 'linear_system', variables: [], equations: ['x + y = 3'], values: {}, calculationSteps: ['Resolver'], derivedAnswer: '1', visualSpec: 'none' } }), { segment: 'anos-finais', gradeYear: 8, subject: 'Matemática' }, { allowMathReviewFallback: true })
    expect(result.issues).toEqual([]); expect(result.warnings.join(' ')).toContain('revisão humana')
  })
})
