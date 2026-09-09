import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUser: vi.fn(),
  findExam: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  isStaffSuperuser: vi.fn(),
  snapshotSheetAssignments: vi.fn(),
  enqueuePontuarProvaJob: vi.fn(),
  isSelfManagedActivity: vi.fn(),
}))

vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
vi.mock('@/db/client', () => ({
  db: {
    query: {
      users: { findFirst: mocks.findUser },
      generatedExams: { findFirst: mocks.findExam },
    },
    update: mocks.update,
  },
}))
vi.mock('@/lib/auth/roles', () => ({ isStaffSuperuser: mocks.isStaffSuperuser }))
vi.mock('@/lib/scan-sheets/sheetAssignments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scan-sheets/sheetAssignments')>('@/lib/scan-sheets/sheetAssignments')
  return { ...actual, snapshotSheetAssignments: mocks.snapshotSheetAssignments }
})
vi.mock('@/lib/queue/enqueue', () => ({ enqueuePontuarProvaJob: mocks.enqueuePontuarProvaJob }))
vi.mock('@/lib/exams/activityWorkflow', () => ({ isSelfManagedActivity: mocks.isSelfManagedActivity }))
vi.mock('@/lib/docs/generateExamDocs', () => ({ generateExamDocs: vi.fn() }))
vi.mock('@/lib/notifications/googleChat', () => ({ sendChatAssignmentNotification: vi.fn(), sendChatReviewReadyNotification: vi.fn() }))

import { POST } from './route'

const exam = {
  id: 31,
  status: 'aprovado',
  examKind: 'prova',
  classroomCourseId: 'course-7',
  assignedTo: null,
  createdBy: 9,
  generationPayload: { questions: [] },
}

function request() {
  return new NextRequest('http://test.local/api/exams/31/status', {
    method: 'POST',
    body: JSON.stringify({ action: 'marcar_impresso' }),
    headers: { 'Content-Type': 'application/json' },
  })
}

function params() {
  return { params: Promise.resolve({ examId: '31' }) }
}

describe('impressão com cartões-resposta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { email: 'coord@colegioharmonia.com.br' }, googleAccessToken: 'token' })
    mocks.findUser.mockResolvedValue({ id: 9, role: 'coordenacao' })
    mocks.findExam.mockResolvedValue(exam)
    mocks.isStaffSuperuser.mockReturnValue(true)
    mocks.isSelfManagedActivity.mockReturnValue(false)
    mocks.snapshotSheetAssignments.mockResolvedValue({
      created: 2,
      assignments: [{ id: 81, status: 'pronta' }, { id: 82, status: 'emitida' }, { id: 83, status: 'pronta' }],
    })
    mocks.update.mockReturnValue({ set: mocks.set.mockReturnValue({ where: mocks.where.mockResolvedValue(undefined) }) })
  })

  it('prepara cartões da turma antes de marcar a prova como impressa', async () => {
    const response = await POST(request(), params())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, readySheetAssignmentIds: [81, 83] })
    expect(mocks.snapshotSheetAssignments).toHaveBeenCalledWith(expect.objectContaining({
      examId: 31,
      exam,
      currentUserId: 9,
      googleAccessToken: 'token',
    }))
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'impresso' }))
  })

  it('não muda o status se o cartão não puder ser preparado', async () => {
    const { SheetAssignmentsSnapshotError } = await import('@/lib/scan-sheets/sheetAssignments')
    mocks.snapshotSheetAssignments.mockRejectedValue(new SheetAssignmentsSnapshotError(401, 'reauth_required', 'Sua conexão com o Google expirou, entre novamente.'))

    const response = await POST(request(), params())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'reauth_required', message: 'Sua conexão com o Google expirou, entre novamente.' })
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
