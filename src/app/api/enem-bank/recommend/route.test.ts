import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), curriculum: vi.fn(), slots: vi.fn(), candidates: vi.fn(), history: vi.fn(), select: vi.fn() }))
vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/curriculum/planCurriculum', () => ({ getCurriculumFromPlan: mocks.curriculum, CurriculumPlanError: class extends Error {} }))
vi.mock('@/lib/exams/plannedEnemSelection', () => ({ buildEnemPlanningSlots: mocks.slots, loadPlannedEnemCandidates: mocks.candidates, loadPlanningQuestionHistory: mocks.history, selectPlannedEnemQuestions: mocks.select }))
import { POST } from './route'
const input = { curriculumPlanId: 105, curriculumPlanVersionId: 113, subject: 'Inglês', gradeYear: 1, academicYear: 2026, bimester: 4, count: 2, total: 12, objectivePercentage: 70, contentPlan: [{ unitRowIndex: 0, questionCount: 12, priority: 'media', visualAid: 'auto' }] }
const request = (body: unknown = input) => new NextRequest('http://localhost/api/enem-bank/recommend', { method: 'POST', body: JSON.stringify(body) })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: '1' } })
  mocks.curriculum.mockResolvedValue({ planReference: { planId: 105, versionId: 113 } })
  mocks.slots.mockReturnValue([{ number: 1 }])
  mocks.candidates.mockResolvedValue([{ id: 1, year: 2023, question_index: 2, context: 'Leadership', skill_code: 'H5', competency_number: 2 }])
  mocks.history.mockResolvedValue([])
  mocks.select.mockResolvedValue({ assignments: [{ questionId: 1, slotNumber: 1, alignment: { status: 'aligned' } }], warnings: ['Somente uma compatível.'] })
})
describe('recomendação baseada no planejamento', () => {
  it('fixa a versão e aplica filtros antes de conferir os candidatos', async () => {
    const filters = { year: 2023, q: 'leadership', skillCode: 'H5' }
    const response = await POST(request({ ...input, filters }))
    expect(response.status).toBe(200)
    expect(mocks.curriculum).toHaveBeenCalledWith(105, expect.objectContaining({ curriculumPlanVersionId: 113, segment: 'ensino-medio', subject: 'Inglês', bimester: 4 }))
    expect(mocks.candidates).toHaveBeenCalledWith('Inglês', undefined, filters)
    expect(await response.json()).toMatchObject({ complete: false, questions: [{ id: 1 }], warnings: ['Somente uma compatível.'] })
  })
  it('exclui itens usados no histórico sem excluir uma escolha explícita', async () => {
    mocks.history.mockResolvedValue([{ enemBankRef: { questionId: 1 } }])
    await POST(request())
    expect(mocks.select).toHaveBeenLastCalledWith(expect.objectContaining({ candidates: [] }))
    await POST(request({ ...input, preferredIds: [1] }))
    expect(mocks.select).toHaveBeenLastCalledWith(expect.objectContaining({ candidates: [expect.objectContaining({ id: 1 })] }))
  })
  it('não troca silenciosamente uma escolha manual incompatível', async () => {
    const response = await POST(request({ ...input, preferredIds: [2] }))
    expect(response.status).toBe(422)
  })
  it('rejeita filtro inválido antes de acessar o banco', async () => {
    expect((await POST(request({ ...input, filters: { year: 1990 } }))).status).toBe(400)
    expect(mocks.candidates).not.toHaveBeenCalled()
  })
  it('exige autenticação', async () => {
    mocks.auth.mockResolvedValue(null)
    expect((await POST(request())).status).toBe(401)
    expect(mocks.curriculum).not.toHaveBeenCalled()
  })
})
