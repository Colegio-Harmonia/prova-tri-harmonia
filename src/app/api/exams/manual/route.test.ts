import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), insert: vi.fn() }))
vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/exams/importedQuestionBloom', () => ({ classifyQuestionBloom: vi.fn() }))
vi.mock('@/lib/exams/questionInepClassification', () => ({ classifyQuestionsInep: vi.fn() }))
vi.mock('@/db/client', () => ({ db: { query: { users: { findFirst: mocks.user } }, insert: () => ({ values: (input: unknown) => { mocks.insert(input); return { returning: async () => [{ id: 9 }] } } }) } }))
import { POST } from './route'
const teacher = { id: 2, active: true, role: 'professor' }
const input = { segment: 'anos-iniciais', gradeYear: 3, subject: 'Filosofia', academicYear: 2026 }
const request = (body = input) => POST(new NextRequest('http://test.local/api/exams/manual', { method: 'POST', body: JSON.stringify(body) }))
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { email: 'teacher@test.local' } }); mocks.user.mockResolvedValue(teacher) })
describe('início da criação manual', () => {
  it('cria rascunho sem BNCC, planejamento ou chave de geração', async () => {
    expect((await request()).status).toBe(201)
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: 2, questionCount: 0, status: 'rascunho', generationPayload: expect.objectContaining({ metadata: expect.objectContaining({ creationMode: 'manual' }) }) }))
  })
  it('ignora atribuição forjada por professor', async () => {
    await request({ ...input, assignedTo: 99 } as typeof input)
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: 2 }))
  })
  it('exige responsável ativo para coordenação', async () => {
    mocks.user.mockResolvedValueOnce({ id: 1, role: 'coordenacao' })
    expect((await request()).status).toBe(422)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('rejeita responsável inativo e segmento inválido', async () => {
    mocks.user.mockResolvedValueOnce(teacher).mockResolvedValueOnce({ ...teacher, active: false })
    expect((await request()).status).toBe(422)
    expect((await request({ ...input, gradeYear: 9 })).status).toBe(400)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it('exige autenticação', async () => {
    mocks.auth.mockResolvedValueOnce(null)
    expect((await request()).status).toBe(401)
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
