import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  loadExamAndAuthorize: vi.fn(),
  listStudentsInCourse: vi.fn(),
  isInsufficientScopeError: vi.fn(),
  transaction: vi.fn(),
  findCorrections: vi.fn(),
  findAssignments: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
}))

vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/corrections/authorize', () => ({ loadExamAndAuthorize: mocks.loadExamAndAuthorize }))
vi.mock('@/lib/classroom/classroomClient', () => ({
  listStudentsInCourse: mocks.listStudentsInCourse,
  isInsufficientScopeError: mocks.isInsufficientScopeError,
}))
vi.mock('@/db/client', () => ({
  db: { transaction: mocks.transaction },
}))

import { POST } from './route'

const exam = {
  id: 31,
  status: 'aprovado',
  classroomCourseId: 'course-7',
  generationPayload: {
    questions: [{
      number: 1,
      type: 'objetiva',
      correctLetter: 'A',
      alternatives: [{ letter: 'A' }, { letter: 'B' }, { letter: 'C' }, { letter: 'D' }, { letter: 'E' }],
    }],
  },
}

function request() {
  return new NextRequest('http://test.local/api/exams/31/sheet-assignments/snapshot', { method: 'POST' })
}

function params() {
  return { params: Promise.resolve({ examId: '31' }) }
}

describe('contrato do congelamento de roster para cartão-resposta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { email: 'professor@colegioharmonia.com.br' }, googleAccessToken: 'token' })
    mocks.loadExamAndAuthorize.mockResolvedValue({ currentUser: { id: 9 }, exam })
    mocks.listStudentsInCourse.mockResolvedValue([
      { classroomStudentId: 'student-1', name: 'Ana', email: 'ana@colegioharmonia.com.br' },
    ])
    mocks.insert.mockReturnValue({ values: mocks.values.mockResolvedValue(undefined) })
    mocks.transaction.mockImplementation(async (callback) => callback({
      query: {
        examCorrections: { findMany: mocks.findCorrections },
        examSheetAssignments: { findMany: mocks.findAssignments },
      },
      insert: mocks.insert,
    }))
  })

  it('bloqueia congelamento sem sessão', async () => {
    mocks.auth.mockResolvedValue(null)

    const response = await POST(request(), params())

    expect(response).toBeDefined()
    expect(response!.status).toBe(401)
    await expect(response!.json()).resolves.toEqual({ error: 'Não autenticado' })
    expect(mocks.loadExamAndAuthorize).not.toHaveBeenCalled()
  })

  it('não permite importar mudanças do Classroom depois da aplicação', async () => {
    mocks.loadExamAndAuthorize.mockResolvedValue({ currentUser: { id: 9 }, exam: { ...exam, status: 'aplicado' } })

    const response = await POST(request(), params())

    expect(response).toBeDefined()
    expect(response!.status).toBe(409)
    await expect(response!.json()).resolves.toEqual({
      error: 'O roster só pode ser congelado para uma prova aprovada ou já marcada como impressa.',
    })
    expect(mocks.listStudentsInCourse).not.toHaveBeenCalled()
  })

  it('cria identidade de correção e atribuição pronta sem expor PII no identificador público', async () => {
    mocks.findCorrections
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 81, classroomStudentId: 'student-1' }])
    mocks.findAssignments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 91, classroomStudentId: 'student-1', studentNameSnapshot: 'Ana', status: 'pronta' }])

    const response = await POST(request(), params())

    expect(response).toBeDefined()
    expect(response!.status).toBe(200)
    await expect(response!.json()).resolves.toEqual({
      created: 1,
      assignments: [{ id: 91, classroomStudentId: 'student-1', studentNameSnapshot: 'Ana', status: 'pronta' }],
    })
    expect(mocks.insert).toHaveBeenCalledTimes(2)
    const assignmentInsert = mocks.values.mock.calls[1][0][0]
    expect(assignmentInsert).toMatchObject({
      examId: 31,
      examCorrectionId: 81,
      classroomStudentId: 'student-1',
      studentNameSnapshot: 'Ana',
      pageCount: 1,
    })
    expect(assignmentInsert.publicId).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect(assignmentInsert.publicId).not.toContain('Ana')
    expect(assignmentInsert.publicId).not.toContain('student-1')
  })
})
