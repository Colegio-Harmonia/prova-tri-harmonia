import { afterEach, describe, expect, it, vi } from 'vitest'
import { enemOriginalIssues, type EnemOriginal } from './enemOriginalQuality'
import { examQuestionSchema, type ExamGenerationResult } from '@/lib/gemini/examSchema'
import { qualityApprovalBlocks, runQuestionQualityTest } from './questionQualityTest'
import { diagnosticsForQuestion, humanReviewDiagnostics } from './qualityDiagnostics'
import { normalizeStoredQualityReport, qualityReportNeedsRecompute } from './qualityReport'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), judge: vi.fn() }))
vi.mock('@/db/client', () => ({ db: { execute: mocks.execute } }))
vi.mock('@/lib/ai/questionQualityDecision', () => ({ judgeQuestionQuality: mocks.judge }))

const original: EnemOriginal = {
  id: 843, year: 2019, context: 'Um poema completo com seu texto de leitura.',
  alternatives_introduction: 'No poema apresentado, qual função da linguagem predomina?',
  correct_alternative: 'A', alternatives: [{ letter: 'A', text: 'Emotiva' }, { letter: 'B', text: 'Fática' }], files: [],
}
const item = () => examQuestionSchema.parse({
  number: 1, source: 'enem_bank', enemBankRef: { questionId: 843, year: 2019 },
  type: 'objetiva', bloomLevel: 'compreender', statement: `${original.context}\n${original.alternatives_introduction}`,
  supportText: null, alternatives: original.alternatives, correctLetter: 'A', bnccCodes: [], bnccStatus: 'nao_mapeado',
  pedagogicalClassification: {
    dok: { categoryCode: 'DOK_1', confidence: 0, justification: 'Teste', evidence: '' },
    soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 0, justification: 'Teste', evidence: '' },
  },
})
const curriculum = { segment: 'ensino-medio' as const, gradeYear: 3, subject: 'Língua Portuguesa', tabName: 'Banco ENEM', units: [], unmappedWarnings: [] }
const payload = (): ExamGenerationResult => ({ metadata: { ...curriculum, questionCount: 1, objectiveCount: 1, discursiveCount: 0, alternativesCount: 2 }, questions: [item()] })
afterEach(() => vi.clearAllMocks())

describe('conferência dos originais do ENEM', () => {
  it('aceita texto integrado e separado, sem exigir texto de apoio duplicado', () => {
    expect(enemOriginalIssues(item(), original)).toEqual([])
    expect(enemOriginalIssues({ ...item(), supportText: original.context, statement: original.alternatives_introduction! }, original)).toEqual([])
  })
  it('bloqueia original ausente, texto alterado, alternativas alteradas e gabarito errado', () => {
    expect(enemOriginalIssues(item())).not.toEqual([])
    expect(enemOriginalIssues({ ...item(), statement: 'Texto alterado' }, original)).toEqual(expect.arrayContaining([expect.stringContaining('texto difere')]))
    expect(enemOriginalIssues({ ...item(), correctLetter: 'B' }, original)).toEqual(expect.arrayContaining([expect.stringContaining('gabarito difere')]))
    expect(enemOriginalIssues({ ...item(), alternatives: [{ letter: 'A', text: 'Alterada' }] }, original)).toEqual(expect.arrayContaining([expect.stringContaining('alternativas diferem')]))
    expect(enemOriginalIssues(item(), { ...original, files: ['imagem.png'] })).toEqual(expect.arrayContaining([expect.stringContaining('imagem original')]))
  })
  it('confere o banco sem chamar o Jev e invalida o parecer quando o conteúdo muda', async () => {
    mocks.execute.mockResolvedValue([original])
    const result = await runQuestionQualityTest(curriculum, [item()])
    expect(mocks.judge).not.toHaveBeenCalled()
    expect(result.report[0]).toMatchObject({ approved: true, auditStatus: 'official_bank_verified', diagnostics: [] })
    const p = payload()
    p.metadata.qualityTest = { version: 'quality-test-v10', checkedAt: new Date().toISOString(), repairedQuestionNumbers: [], warnings: [], reports: [{ phase: 'Banco', results: result.report }] }
    expect(qualityApprovalBlocks(p)).toEqual([])
    expect(qualityReportNeedsRecompute(p)).toBe(false)
    p.questions[0]!.correctLetter = 'B'
    expect(qualityApprovalBlocks(p)).not.toEqual([])
    expect(qualityReportNeedsRecompute(p)).toBe(true)
  })
  it('não aprova item adulterado só por possuir referência ENEM', async () => {
    mocks.execute.mockResolvedValue([original])
    const result = await runQuestionQualityTest(curriculum, [{ ...item(), correctLetter: 'B' }])
    expect(result.report[0]).toMatchObject({ approved: false, auditStatus: 'official_bank_invalid' })
    expect(result.report[0]?.issues[0]?.severity).toBe('bloqueante')
  })
  it('remove falsos diagnósticos históricos e pede a conferência do banco', () => {
    const p = payload()
    p.metadata.qualityTest = { version: 'quality-test-v10', checkedAt: new Date().toISOString(), repairedQuestionNumbers: [], warnings: [], reports: [{ phase: 'Antiga', results: [{
      questionNumber: 1, approved: false, auditStatus: 'jev_unavailable', issues: [],
      diagnostics: [{ code: 'REGENERATE_QUESTION', fields: [], protectedFields: [], severity: 'revisao_humana', repairAction: 'revisao_humana', message: 'O Jev não concluiu a avaliação.', blocksApproval: true }],
    }] }] }
    expect(diagnosticsForQuestion(p, 1)).toEqual([])
    expect(humanReviewDiagnostics(p)).toEqual([])
    expect(qualityReportNeedsRecompute(p)).toBe(true)
    expect(qualityApprovalBlocks(p)).not.toEqual([])
    expect(normalizeStoredQualityReport(p).metadata.qualityTest?.reports?.[0]?.results[0]?.approved).toBe(false)
  })
  it('não reintroduz auditoria Jev para a prova inteira gerada com IA', () => {
    const p = payload()
    p.questions[0] = { ...item(), source: 'ia', enemBankRef: null }
    p.metadata.generationEngine = 'whole-exam-v1'
    expect(qualityReportNeedsRecompute(p)).toBe(false)
  })
})
