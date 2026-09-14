import { describe, expect, it } from 'vitest'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { deterministicQuestionQualityIssues, qualityApprovalBlocks } from './questionQualityTest'

function question(alternatives: Array<{ letter: string; text: string }>): ExamQuestion {
  return {
    number: 1, source: 'ia', type: 'objetiva', bloomLevel: 'compreender', statement: 'Teste', supportText: null, alternatives, correctLetter: 'A', expectedAnswer: null, gradingCriteria: null,
    bnccCodes: [], bnccStatus: 'nao_mapeado', bnccSummary: null, pedagogicalClassification: { dok: { categoryCode: 'DOK_1', confidence: 1, justification: 'teste', evidence: 'teste' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 1, justification: 'teste', evidence: 'teste' } },
    saeb: { applicable: false, source: null, value: null, approximate: false }, needsImage: false, imageQuery: null, image: null, review: null,
  }
}

describe('teste de qualidade determinístico', () => {
  it('bloqueia alternativas duplicadas mesmo com diferenças de acento e espaço', () => {
    const issues = deterministicQuestionQualityIssues([question([{ letter: 'A', text: 'São Paulo' }, { letter: 'B', text: ' sao paulo ' }])])
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('bloqueante')
  })

  it('bloqueia juros compostos quando nenhuma alternativa contém o saldo calculado', () => {
    const item = question([{ letter: 'A', text: 'R$ 8.050,00' }, { letter: 'E', text: 'R$ 8.813,50' }])
    item.statement = 'Uma empresa investe em um fundo que rende a cada mês uma taxa fixa de 10% sobre o valor acumulado. O valor inicial investido foi de R$ 5.000,00. Qual será o saldo acumulado ao final do 6º mês?'
    item.correctLetter = 'E'
    const issues = deterministicQuestionQualityIssues([item])
    expect(issues.some((issue) => issue.reason.includes('Juros compostos/P.G.'))).toBe(true)
  })

  it('bloqueia aprovação quando o parecer descreve gabarito divergente, mesmo que o cartão venha como aprovado', () => {
    const item = question([{ letter: 'A', text: '2400 litros' }, { letter: 'D', text: '3600 litros' }])
    item.correctLetter = 'D'
    const blocks = qualityApprovalBlocks({
      metadata: {
        segment: 'anos-finais', gradeYear: 8, subject: 'Matemática', questionCount: 1, objectiveCount: 1, discursiveCount: 0, alternativesCount: 5,
        qualityTest: {
          version: 'quality-test-v1', checkedAt: new Date().toISOString(), repairedQuestionNumbers: [], warnings: [],
          reports: [{ phase: 'Análise', results: [{
            questionNumber: 1, approved: true, verdictReason: 'Aprovada', issues: [],
            checks: [{ criterion: 'gabarito', status: 'aprovado', evidence: 'Alternativa correta deveria ser A (2400 litros), mas o gabarito declarado é D.' }],
          }] }],
        },
      },
      questions: [item],
    })
    expect(blocks).toContain('Questão 1: falta confirmação independente de que o gabarito (D) é a alternativa correta.')
  })

  it('libera aprovação somente com confirmação independente da letra correta', () => {
    const item = question([{ letter: 'A', text: '2400 litros' }, { letter: 'D', text: '3600 litros' }])
    const blocks = qualityApprovalBlocks({
      metadata: {
        segment: 'anos-finais', gradeYear: 8, subject: 'Matemática', questionCount: 1, objectiveCount: 1, discursiveCount: 0, alternativesCount: 5,
        qualityTest: {
          version: 'quality-test-v2', checkedAt: new Date().toISOString(), repairedQuestionNumbers: [], warnings: [],
          reports: [{ phase: 'Análise', results: [{
            questionNumber: 1, approved: true, verdictReason: 'Aprovada', issues: [],
            checks: [{ criterion: 'gabarito', status: 'aprovado', evidence: 'A alternativa A corresponde ao resultado.' }],
            answerKeyAudit: { declaredLetter: 'A', independentlyDerivedLetter: 'A', matchesDeclared: true, evidence: 'Resultado 2400 litros.' },
          }] }],
        },
      },
      questions: [item],
    })
    expect(blocks).toEqual([])
  })
})
