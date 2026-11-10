import { describe, expect, it } from 'vitest'
import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'
import { deterministicQuestionQualityIssues, isNotApplicableEvidence, normalizeQualityChecks, qualityApprovalBlocks, reportAfterCorrectionWithoutReaudit, solutionBlueprintEvidence } from './questionQualityTest'

function question(alternatives: Array<{ letter: string; text: string }>): ExamQuestion {
  return {
    number: 1, source: 'ia', type: 'objetiva', bloomLevel: 'compreender', statement: 'Teste', supportText: null, alternatives, correctLetter: 'A', expectedAnswer: null, gradingCriteria: null,
    bnccCodes: [], bnccStatus: 'nao_mapeado', bnccSummary: null, pedagogicalClassification: { dok: { categoryCode: 'DOK_1', confidence: 1, justification: 'teste', evidence: 'teste' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 1, justification: 'teste', evidence: 'teste' } },
    saeb: { applicable: false, source: null, value: null, approximate: false }, needsImage: false, imageQuery: null, image: null, review: null,
  }
}

function descriptiveQuestion(): ExamQuestion {
  const item = question([])
  item.type = 'descritiva'
  item.alternatives = null
  item.correctLetter = null
  item.expectedAnswer = 'Resposta esperada.'
  item.gradingCriteria = 'Critérios.'
  return item
}

function payloadWithReport(item: ExamQuestion, result: Record<string, unknown>): ExamGenerationResult {
  return {
    metadata: {
      segment: 'ensino-medio', gradeYear: 2, subject: 'Química', questionCount: 1, objectiveCount: 0, discursiveCount: 1, alternativesCount: 5,
      qualityTest: {
        version: 'quality-test-v3', checkedAt: new Date().toISOString(), repairedQuestionNumbers: [], warnings: [],
        reports: [{ phase: 'Auditoria final obrigatória', results: [{ questionNumber: item.number, ...result } as never] }],
      },
    },
    questions: [item],
  }
}

describe('teste de qualidade determinístico', () => {
  it.each([null, 'A era do selfie', 'Uma frase curta.'])('permite aprovação com referência ao material didático e apoio %s', (supportText) => {
    const item = question([{ letter: 'A', text: 'Resposta correta' }, { letter: 'B', text: 'Distrator plausível' }])
    item.statement = 'De acordo com o capítulo do material didático, qual é a ideia principal?'
    item.supportText = supportText
    const payload = payloadWithReport(item, {})
    payload.metadata.generationEngine = 'whole-exam-v1'
    expect(deterministicQuestionQualityIssues([item])).toEqual([])
    expect(qualityApprovalBlocks(payload)).toEqual([])
  })
  it('impede aprovação da prova completa com referência a figura dispensada', () => {
    const item = question([{ letter: 'A', text: 'Figura A' }, { letter: 'B', text: 'Figura B' }])
    item.statement = 'Na malha quadriculada, qual figura representa o triângulo espelhado?'
    const payload = payloadWithReport(item, {})
    payload.metadata.generationEngine = 'whole-exam-v1'
    expect(qualityApprovalBlocks(payload)).toContain('Questão 1: o enunciado faz referência a uma figura ausente.')
    item.hasImage = true
    item.needsImage = true
    expect(qualityApprovalBlocks(payload)).toContain('Questão 1: imagem obrigatória ainda não foi produzida.')
  })
  it('exige decisão humana quando a revisão visual falha, preservando uma questão autossuficiente', () => {
    const item = question([{ letter: 'A', text: '3' }, { letter: 'B', text: '4' }])
    item.statement = 'Quantos lados tem um triângulo?'
    item.visualReview = { status: 'pending' }
    const payload = payloadWithReport(item, {})
    payload.metadata.generationEngine = 'whole-exam-v1'
    expect(qualityApprovalBlocks(payload)).toContain('Questão 1: revisão visual automática pendente; confira a questão e registre sua decisão.')
    item.review = { adequacy: 'adequada' }
    expect(qualityApprovalBlocks(payload)).toEqual([])
  })
  it('bloqueia alternativas duplicadas mesmo com diferenças de acento e espaço', () => {
    const issues = deterministicQuestionQualityIssues([question([{ letter: 'A', text: 'São Paulo' }, { letter: 'B', text: ' sao paulo ' }])])
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('bloqueante')
  })

  it('mantém indícios de alternativas na auditoria sem bloquear a aprovação docente', () => {
    const item = question([{ letter: 'A', text: '10 metros de comprimento total' }, { letter: 'B', text: '10 metros de comprimento total' }])
    const payload = payloadWithReport(item, {})
    payload.metadata.generationEngine = 'whole-exam-v1'
    expect(deterministicQuestionQualityIssues([item]).some((issue) => issue.severity === 'bloqueante')).toBe(true)
    expect(qualityApprovalBlocks(payload)).toEqual([])
    item.correctLetter = 'Z'
    expect(qualityApprovalBlocks(payload)).toContain('Questão 1: gabarito ou alternativas inválidos.')
  })

  it('não exige ficha técnica recalculável na aprovação de uma prova já gerada', () => {
    const item = question([{ letter: 'A', text: '3' }, { letter: 'B', text: '4' }])
    item.solutionBlueprint = {
      domain: 'ratio_proportion', variables: [], equations: [], values: {},
      calculationSteps: [], derivedAnswer: '3', visualSpec: 'none',
    }
    const payload = payloadWithReport(item, {})
    payload.metadata.generationEngine = 'whole-exam-v1'
    expect(deterministicQuestionQualityIssues([item]).some((issue) => issue.reason.includes('Conferência determinística'))).toBe(true)
    expect(qualityApprovalBlocks(payload)).toEqual([])
  })

  it('bloqueia juros compostos quando nenhuma alternativa contém o saldo calculado', () => {
    const item = question([{ letter: 'A', text: 'R$ 8.050,00' }, { letter: 'E', text: 'R$ 8.813,50' }])
    item.statement = 'Uma empresa investe em um fundo que rende a cada mês uma taxa fixa de 10% sobre o valor acumulado. O valor inicial investido foi de R$ 5.000,00. Qual será o saldo acumulado ao final do 6º mês?'
    item.correctLetter = 'E'
    const issues = deterministicQuestionQualityIssues([item])
    expect(issues.some((issue) => issue.reason.includes('Juros compostos/P.G.'))).toBe(true)
  })

  it('transforma divergência matemática recalculável em evidência explícita para o Jev', () => {
    const item = question([{ letter: 'A', text: 'R$ 30,00' }, { letter: 'B', text: 'R$ 20,00' }])
    item.correctLetter = 'B'
    item.solutionBlueprint = {
      domain: 'percentage', variables: [], equations: [], values: { base: 200, percent: 15 },
      calculationSteps: ['200 × 15 ÷ 100 = 30'], derivedAnswer: '30', visualSpec: 'none',
    }
    const evidence = solutionBlueprintEvidence(item)
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toContain('a alternativa marcada no gabarito não corresponde')
    expect(evidence[0]).toContain('(30)')
    expect(evidence[0]).toContain('evidência preliminar; a decisão de qualidade cabe ao Jev')
  })

  it('marca correção sem reauditoria sem afirmar que o Jev aprovou a nova versão', () => {
    const original = question([{ letter: 'A', text: 'Resposta correta' }, { letter: 'B', text: 'Distrator plausível' }])
    const initial = {
      questionNumber: 1, questionFingerprint: 'old', approved: false, verdictReason: 'Reprovada pelo Jev',
      answerKeyAudit: null, checks: [{ criterion: 'resposta_induzida', status: 'reprovado' as const, evidence: 'A conclusão aparece no apoio.' }],
      issues: [{ severity: 'bloqueante' as const, reason: 'Teste de qualidade — resposta_induzida: conclusão exposta.' }],
      diagnostics: [{ code: 'ANSWER_CUE_EXPOSED' as const, severity: 'bloqueante' as const, repairAction: 'reparo_local' as const, fields: ['statement'], protectedFields: [], message: 'Remova a pista.', blocksApproval: true }],
    }
    const updated = reportAfterCorrectionWithoutReaudit(initial, { ...original, statement: 'Enunciado alterado.' }, true)
    expect(updated).toMatchObject({ approved: true, auditStatus: 'corrected_without_reaudit', answerKeyAudit: null })
    expect(updated.verdictReason).toContain('sem nova avaliação do Jev')
    expect(updated.diagnostics?.[0]).toMatchObject({ severity: 'alerta', repairAction: 'nenhuma', blocksApproval: false })
    expect(updated.issues[0]?.severity).toBe('alerta')
  })

  it('permite incluir questão corrigida sem reauditoria e ainda confere se o JSON objetivo é estruturalmente válido', () => {
    const item = question([{ letter: 'A', text: 'Resultado A' }, { letter: 'B', text: 'Resultado B' }])
    const result = {
      questionNumber: 1, approved: true, auditStatus: 'corrected_without_reaudit' as const,
      verdictReason: 'Correção sem reauditoria.', answerKeyAudit: null,
      issues: [{ severity: 'alerta' as const, reason: 'Diagnóstico da versão inicial.' }],
      checks: [{ criterion: 'gabarito', status: 'reprovado' as const, evidence: 'Versão anterior.' }],
    }
    expect(qualityApprovalBlocks(payloadWithReport(item, result))).toEqual([])
    item.correctLetter = 'Z'
    expect(qualityApprovalBlocks(payloadWithReport(item, result))).toContain('Questão 1: correção sem reauditoria deixou gabarito ou alternativas inválidos.')
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

  it('reconhece evidência de critério não aplicável mesmo com acentos', () => {
    expect(isNotApplicableEvidence('Não aplicável, trata-se de análise conceitual, sem cálculos ou dados quantitativos.')).toBe(true)
    expect(isNotApplicableEvidence('O saldo calculado diverge do gabarito declarado.')).toBe(false)
  })

  it('normaliza critério reprovado com texto de não aplicável para não_aplicável', () => {
    const checks = normalizeQualityChecks([
      { criterion: 'cálculo_ou_dados', status: 'reprovado', evidence: 'Não aplicável: questão conceitual, sem cálculos.' },
      { criterion: 'linguagem', status: 'aprovado', evidence: 'Clara.' },
    ])
    expect(checks[0].status).toBe('não_aplicável')
    expect(checks[1].status).toBe('aprovado')
  })

  it('não bloqueia questão discursiva cujo único reprovado é um critério não aplicável', () => {
    const item = descriptiveQuestion()
    const blocks = qualityApprovalBlocks(payloadWithReport(item, {
      approved: false,
      verdictReason: 'Questão discursiva clara, sem cálculos envolvidos e alinhada ao conteúdo.',
      checks: [
        { criterion: 'gabarito', status: 'não_aplicável', evidence: 'Questão discursiva, sem alternativa correta definida.' },
        { criterion: 'unicidade', status: 'não_aplicável', evidence: 'Questão aberta, sem respostas fixas.' },
        { criterion: 'cálculo_ou_dados', status: 'reprovado', evidence: 'Não aplicável, trata-se de análise conceitual, sem cálculos ou dados quantitativos.' },
        { criterion: 'linguagem', status: 'aprovado', evidence: 'Linguagem clara.' },
        { criterion: 'alinhamento', status: 'aprovado', evidence: 'Alinhada ao conteúdo.' },
      ],
      issues: [{ severity: 'bloqueante', reason: 'Teste de qualidade — cálculo_ou_dados: Não aplicável, trata-se de análise conceitual, sem cálculos ou dados quantitativos.' }],
    }))
    expect(blocks).toEqual([])
  })

  it('não deixa avaliação editorial de linguagem bloquear questão discursiva', () => {
    const item = descriptiveQuestion()
    const blocks = qualityApprovalBlocks(payloadWithReport(item, {
      approved: false,
      verdictReason: 'Enunciado ambíguo.',
      checks: [
        { criterion: 'linguagem', status: 'reprovado', evidence: 'O enunciado admite duas respostas incompatíveis.' },
      ],
      issues: [],
    }))
    expect(blocks).toEqual([])
  })
})
