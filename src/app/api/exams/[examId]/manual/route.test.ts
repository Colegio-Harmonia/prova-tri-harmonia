import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { examQuestionSchema, type ExamQuestion } from '@/lib/gemini/examSchema'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), authorize: vi.fn(), importQuestion: vi.fn(), classify: vi.fn(), set: vi.fn(), locked: null as unknown }))
vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/exams/authorizeExamAccess', () => ({ authorizeExamAccess: mocks.authorize }))
vi.mock('@/lib/exams/acervoQuestions', async (original) => ({ ...await original<typeof import('@/lib/exams/acervoQuestions')>(), importAcervoQuestionById: mocks.importQuestion }))
vi.mock('@/lib/exams/manualExam', async (original) => ({ ...await original<typeof import('@/lib/exams/manualExam')>(), classifyManualQuestion: mocks.classify }))
vi.mock('@/lib/exams/acervoPresentation', () => ({ presentAcervoExam: (exam: unknown) => exam }))
vi.mock('@/lib/exams/importedQuestionBloom', () => ({ classifyQuestionBloom: vi.fn() }))
vi.mock('@/lib/exams/questionInepClassification', () => ({ classifyQuestionsInep: vi.fn() }))
vi.mock('@/db/client', () => ({ db: { transaction: async (run: (tx: unknown) => unknown) => run({
  select: () => ({ from: () => ({ where: () => ({ for: async () => [mocks.locked] }) }) }),
  update: () => ({ set: (value: unknown) => { mocks.set(value); return { where: async () => undefined } } }),
}) } }))
import { POST } from './route'
import { assembleManualExam } from '@/lib/exams/manualExam'
const question = (id: number) => examQuestionSchema.parse({ number: 1, type: 'objetiva', source: 'acervo', statement: `Original ${id}`, bloomLevel: 'compreender', bnccCodes: [], bnccStatus: 'nao_mapeado', acervoRef: { questionId: id, origin: 'SAE', externalId: `original-${id}`, portalUrl: null, importedAt: '2026-10-30', original: {} },
  pedagogicalClassification: { dok: { categoryCode: 'DOK_1', confidence: 0, justification: '', evidence: '' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 0, justification: '', evidence: '' } },
  alternatives: [{ letter: 'A', text: 'A' }, { letter: 'B', text: 'B' }], correctLetter: 'B',
  bloomAssessment: { status: 'classified', source: 'provider', model: 'jev', confidence: 0.9, classifiedAt: '2026-10-30' },
  inepAssessment: { version: 'v2', status: 'not_applicable', source: 'fallback', model: 'jev', confidence: null, matrix: null, area: null, competency: null, skill: null, approximate: false, referenceGrade: null, classifiedAt: '2026-10-30' },
})
function draft(questions: ExamQuestion[] = []) {
  return { id: 9, status: 'rascunho', segment: 'anos-iniciais', gradeYear: 3, subject: 'Filosofia', generationPayload: assembleManualExam({ segment: 'anos-iniciais', gradeYear: 3, subject: 'Filosofia', questionCount: 0, objectiveCount: 0, discursiveCount: 0, alternativesCount: 0 }, questions) }
}
async function request(body: unknown) {
  const response = await POST(new NextRequest('http://test.local/api/exams/9/manual', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ examId: '9' }) })
  if (!response) throw new Error('A rota não retornou uma resposta.')
  return response
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { email: 'teacher@test.local' } })
  mocks.authorize.mockResolvedValue({ currentUser: { id: 3 }, exam: draft() })
  mocks.locked = draft()
  mocks.importQuestion.mockImplementation(async (id: number) => question(id))
  mocks.classify.mockImplementation(async (question: ExamQuestion) => question)
})
describe('edição persistente da prova manual', () => {
  it('exige autenticação e autorização antes de importar', async () => {
    mocks.auth.mockResolvedValueOnce(null)
    expect((await request({ action: 'import', questionId: 1 })).status).toBe(401)
    mocks.authorize.mockResolvedValueOnce({ error: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) })
    expect((await request({ action: 'import', questionId: 1 })).status).toBe(403)
    expect(mocks.importQuestion).not.toHaveBeenCalled()
  })
  it('importa pelo ID e aciona classificação antes de salvar', async () => {
    const response = await request({ action: 'import', questionId: 7 })
    expect(response.status).toBe(200)
    expect(mocks.importQuestion).toHaveBeenCalledWith(7, 1)
    expect(mocks.classify).toHaveBeenCalledWith(question(7), expect.objectContaining({ subject: 'Filosofia' }))
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ questionCount: 1, generationPayload: expect.objectContaining({ questions: [expect.objectContaining({ correctLetter: 'B', number: 1 })] }) }))
  })
  it('mescla importação concorrente com a versão mais recente do rascunho', async () => {
    mocks.locked = draft([question(2)])
    const response = await request({ action: 'import', questionId: 7 })
    const body = await response.json()
    expect(body.exam.questions.map((q: ExamQuestion) => q.acervoRef?.questionId)).toEqual([2, 7])
    expect(body.exam.questions.map((q: ExamQuestion) => q.number)).toEqual([1, 2])
  })
  it('não duplica a mesma seleção durante duas importações simultâneas', async () => {
    mocks.locked = draft([question(7)])
    expect((await request({ action: 'import', questionId: 7 })).status).toBe(409)
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it('preserva o rascunho se a questão não puder ser importada', async () => {
    mocks.importQuestion.mockRejectedValueOnce(new Error('incomplete'))
    expect((await request({ action: 'import', questionId: 7 })).status).toBe(502)
    expect(mocks.classify).not.toHaveBeenCalled()
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it('informa o motivo quando o acervo recusa a questão, sem sugerir nova tentativa', async () => {
    const { AcervoQuestionRejectedError } = await import('@/lib/exams/acervoQuestions')
    mocks.importQuestion.mockRejectedValueOnce(new AcervoQuestionRejectedError('Esta questão tem 3 alternativas; o cartão-resposta exige 4 ou 5.', { code: 'alternatives_count', count: 3 }))
    const response = await request({ action: 'import', questionId: 7 })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'Esta questão tem 3 alternativas; o cartão-resposta exige 4 ou 5.' })
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it('mantém 502 com sugestão de nova tentativa quando a falha do acervo é passageira', async () => {
    const { AcervoUnavailableError } = await import('@/lib/exams/acervoQuestions')
    mocks.importQuestion.mockRejectedValueOnce(new AcervoUnavailableError('Não foi possível importar esta questão completa. Escolha outra questão ou tente novamente.'))
    const response = await request({ action: 'import', questionId: 7 })
    expect(response.status).toBe(502)
    expect((await response.json()).error).toContain('tente novamente')
  })
  it('salva questão com classificação pendente e impede conclusão incompleta', async () => {
    const pending = { ...question(7), bloomAssessment: undefined }
    mocks.classify.mockResolvedValue(pending)
    expect((await request({ action: 'import', questionId: 7 })).status).toBe(200)
    mocks.set.mockClear()
    mocks.locked = draft([pending])
    expect((await request({ action: 'finish' })).status).toBe(409)
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it('reordena sem perder gabaritos e recalcula numeração depois da remoção', async () => {
    mocks.locked = draft([question(7), question(8)])
    const response = await request({ action: 'reorder', questionIds: [8, 7] })
    const body = await response.json()
    expect(body.exam.questions.map((q: ExamQuestion) => [q.number, q.acervoRef?.questionId, q.correctLetter])).toEqual([[1, 8, 'B'], [2, 7, 'B']])
    mocks.locked = draft([question(7), question(8)])
    const removed = await (await request({ action: 'remove', questionId: 7 })).json()
    expect(removed.exam.questions[0]).toMatchObject({ number: 1, acervoRef: { questionId: 8 } })
  })
  it('rejeita ordenação que exclua uma questão salva em outra janela', async () => {
    mocks.locked = draft([question(7), question(8)])
    expect((await request({ action: 'reorder', questionIds: [7] })).status).toBe(409)
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it('retoma apenas a classificação sem baixar novamente a questão', async () => {
    mocks.authorize.mockResolvedValue({ currentUser: { id: 3 }, exam: draft([question(7)]) })
    mocks.locked = draft([question(7)])
    expect((await request({ action: 'retry', questionId: 7 })).status).toBe(200)
    expect(mocks.importQuestion).not.toHaveBeenCalled()
  })
  it('não altera prova concluída e conclui rascunho com classificações completas', async () => {
    mocks.locked = { ...draft([question(7)]), status: 'atribuido' }
    expect((await request({ action: 'remove', questionId: 7 })).status).toBe(409)
    mocks.locked = draft([question(7)])
    expect((await request({ action: 'finish' })).status).toBe(200)
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'atribuido' }))
  })
})
