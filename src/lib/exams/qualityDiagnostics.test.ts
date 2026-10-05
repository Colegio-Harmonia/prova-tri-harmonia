import { describe, expect, it } from 'vitest'
import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'
import { diagnosticFromIssue, diagnosticFromJevIssue, humanReviewApprovalBlocks } from './qualityDiagnostics'
import { NO_CORRECT_ALTERNATIVE } from '@/lib/ai/questionQualityDecision'

function question(review: ExamQuestion['review'] = null): ExamQuestion {
  return {
    number: 1, source: 'ia', type: 'objetiva', bloomLevel: 'aplicar', statement: 'Qual alternativa representa o resultado?', supportText: null,
    alternatives: [{ letter: 'A', text: '10' }, { letter: 'B', text: '20' }, { letter: 'C', text: '30' }, { letter: 'D', text: '40' }, { letter: 'E', text: '50' }], correctLetter: 'A', expectedAnswer: null, gradingCriteria: null,
    solutionBlueprint: null, bnccCodes: [], bnccStatus: 'nao_mapeado', bnccSummary: null,
    pedagogicalClassification: { dok: { categoryCode: 'DOK_1', confidence: 1, justification: 'teste', evidence: 'teste' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 1, justification: 'teste', evidence: 'teste' } },
    saeb: { applicable: false, source: null, value: null, approximate: false }, needsImage: false, imageQuery: null, image: null, review,
  }
}

describe('quality diagnostics', () => {
  it('classifica distrator duplicado como reparo local', () => {
    const diagnostic = diagnosticFromIssue({ severity: 'bloqueante', reason: '[distratores] Há distratores repetidos ("a").' })
    expect(diagnostic.code).toBe('DUPLICATE_ALTERNATIVE')
    expect(diagnostic.repairAction).toBe('reparo_local')
    expect(diagnostic.fields).toEqual(['alternatives'])
  })

  it('preserva o motivo estrutural quando a IA não devolve JSON utilizável', () => {
    const diagnostic = diagnosticFromIssue({
      severity: 'bloqueante',
      reason: '[ia:invalid_json] Resposta da IA inválida após 3 tentativa(s). Detalhe: distractors: Required.',
    })
    expect(diagnostic.code).toBe('INVALID_AI_RESPONSE')
    expect(diagnostic.repairAction).toBe('regenerar_questao')
  })

  it('roteia critérios tipados do Jev sem interpretar a mensagem', () => {
    const exposed = diagnosticFromJevIssue({ criterion: 'resposta_exposta_enunciado', severity: 'bloqueante', reason: 'qualquer texto' }, question(), null)
    expect(exposed).toMatchObject({ code: 'ANSWER_EXPOSED_IN_STATEMENT', repairAction: 'reparo_local', fields: ['statement'] })

    const noAnswer = diagnosticFromJevIssue(
      { criterion: 'gabarito', severity: 'bloqueante', reason: 'qualquer texto' },
      question(),
      { declaredLetter: 'A', independentLetter: NO_CORRECT_ALTERNATIVE, confidence: 0.95, matches: false },
    )
    expect(noAnswer).toMatchObject({ code: 'NO_CORRECT_ALTERNATIVE', repairAction: 'reparo_local', fields: ['alternatives', 'correctLetter'] })
  })

  it('exige confirmação humana para cálculo não verificável', () => {
    const payload = {
      metadata: {
        segment: 'anos-finais', gradeYear: 9, subject: 'Matemática', questionCount: 1, objectiveCount: 1, discursiveCount: 0, alternativesCount: 5,
        qualityTest: { version: 'quality-test-v4', checkedAt: new Date().toISOString(), repairedQuestionNumbers: [], warnings: [], reports: [{ phase: 'Teste', results: [{ questionNumber: 1, approved: true, issues: [], diagnostics: [{ code: 'CALCULATION_UNVERIFIED', severity: 'revisao_humana', repairAction: 'revisao_humana', fields: ['solutionBlueprint'], protectedFields: [], message: 'Confira o cálculo.', evidence: null, blocksApproval: true }] }] }] },
      },
      questions: [question()],
    } satisfies ExamGenerationResult
    expect(humanReviewApprovalBlocks(payload)).toEqual(['Questão 1: Confira o cálculo.'])
    payload.questions[0].review = { adequacy: 'adequada' }
    expect(humanReviewApprovalBlocks(payload)).toEqual([])
  })
})
