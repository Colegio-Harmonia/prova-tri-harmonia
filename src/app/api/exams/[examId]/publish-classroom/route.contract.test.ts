import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  authorizeExamAccess: vi.fn(),
  findResponsibleTeacher: vi.fn(),
  createActivityForm: vi.fn(),
  listMyCourses: vi.fn(),
}))

vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/exams/authorizeExamAccess', () => ({ authorizeExamAccess: mocks.authorizeExamAccess }))
vi.mock('@/db/client', () => ({
  db: { query: { users: { findFirst: mocks.findResponsibleTeacher } } },
}))
vi.mock('@/lib/forms/activityForm', () => ({
  activityFormEditUrl: (formId: string) => `https://docs.google.com/forms/d/${formId}/edit`,
  createActivityForm: mocks.createActivityForm,
  deleteActivityForm: vi.fn(),
  shareActivityFormWithTeacher: vi.fn(),
}))
vi.mock('@/lib/classroom/classroomClient', () => ({
  createCourseWorkWithForm: vi.fn(),
  createCourseWorkWithLinkMaterial: vi.fn(),
  createCourseWorkWithMaterial: vi.fn(),
  deleteCourseWork: vi.fn(),
  isInsufficientScopeError: vi.fn(),
  listMyCourses: mocks.listMyCourses,
  summarizeClassroomApiError: vi.fn(),
}))

import { POST } from './route'

const activity = {
  id: 75,
  examKind: 'atividade',
  status: 'aprovado',
  provaDocId: 'doc-1',
  classroomCourseId: 'course-1',
  classroomCourseWorkId: null,
  assignedTo: 9,
  subject: 'Ciências',
  gradeYear: 9,
  generationPayload: { metadata: { activity: { bnccCodes: ['EF08CI08'] } }, questions: [] },
}

function request() {
  return new NextRequest('http://test.local/api/exams/75/publish-classroom', { method: 'POST', body: JSON.stringify({}) })
}

describe('publicação de atividade com Form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { email: 'coordenacao@colegioharmonia.com.br' }, googleAccessToken: 'token' })
    mocks.authorizeExamAccess.mockResolvedValue({ currentUser: { id: 1 }, exam: activity })
    mocks.findResponsibleTeacher.mockResolvedValue({ email: 'tamires@colegioharmonia.com.br' })
  })

  it('exige nova autorização do Drive antes de criar um Form que precisará ser compartilhado', async () => {
    const response = await POST(request(), { params: Promise.resolve({ examId: '75' }) })

    if (!response) throw new Error('Rota não devolveu resposta.')
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'reauth_required', stage: 'share_form_with_teacher' })
    expect(mocks.createActivityForm).not.toHaveBeenCalled()
    expect(mocks.listMyCourses).not.toHaveBeenCalled()
  })
})
