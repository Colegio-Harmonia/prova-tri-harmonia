import { NextRequest } from 'next/server'
import { AxiosError, AxiosHeaders } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUser: vi.fn(),
  findExam: vi.fn(),
  update: vi.fn(),
  txFindExam: vi.fn(),
  txExecute: vi.fn(),
  txUpdates: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  updates: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  isStaffSuperuser: vi.fn(),
  deleteCourseWork: vi.fn(),
}))

vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/auth/roles', () => ({ isStaffSuperuser: mocks.isStaffSuperuser }))
vi.mock('@/lib/classroom/classroomClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/classroom/classroomClient')>('@/lib/classroom/classroomClient')
  return { ...actual, deleteCourseWork: mocks.deleteCourseWork }
})
vi.mock('@/db/client', () => {
  function updateChain(log: Array<{ table: unknown; values: Record<string, unknown> }>) {
    return (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        log.push({ table, values })
        const where = () => Object.assign(Promise.resolve(undefined), { returning: async () => [{ id: 744, ...values }] })
        return { where }
      },
    })
  }
  return {
    db: {
      query: {
        users: { findFirst: mocks.findUser },
        generatedExams: { findFirst: mocks.findExam },
      },
      update: (table: unknown) => { mocks.update(table); return updateChain(mocks.updates)(table) },
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        execute: mocks.txExecute,
        query: { generatedExams: { findFirst: mocks.txFindExam } },
        update: updateChain(mocks.txUpdates),
      }),
    },
  }
})

import { POST } from './route'
import { examCorrections, generatedExams } from '@/db/schema'

const wrongCourseExam = {
  id: 744,
  examKind: 'prova',
  assignedTo: 5,
  classroomCourseId: 'artes-3b',
  classroomCourseWorkId: 'cw-artes',
}

function request(body: Record<string, unknown>) {
  return new NextRequest('http://test.local/api/exams/744/link-course', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

const params = () => ({ params: Promise.resolve({ examId: '744' }) })

function notFound() {
  return new AxiosError('not found', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 404, statusText: 'Not Found', headers: {}, config: { headers: new AxiosHeaders() }, data: { error: { status: 'NOT_FOUND' } },
  })
}

describe('POST /api/exams/[examId]/link-course', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updates.length = 0
    mocks.txUpdates.length = 0
    mocks.auth.mockResolvedValue({ user: { email: 'marli@colegioharmonia.com.br' }, googleAccessToken: 'token' })
    mocks.findUser.mockResolvedValue({ id: 5, role: 'professor' })
    mocks.isStaffSuperuser.mockReturnValue(false)
    mocks.findExam.mockResolvedValue(wrongCourseExam)
    mocks.txFindExam.mockResolvedValue(wrongCourseExam)
    mocks.deleteCourseWork.mockResolvedValue(undefined)
  })

  it('recusa trocar a turma com atividade criada sem pedido explícito', async () => {
    const response = await POST(request({ classroomCourseId: 'ciencias-3b' }), params())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'course_work_exists' })
    expect(mocks.updates).toHaveLength(0)
    expect(mocks.deleteCourseWork).not.toHaveBeenCalled()
  })

  it('troca a turma, zera atividade e notas lançadas, e apaga a atividade antiga depois', async () => {
    const response = await POST(request({ classroomCourseId: 'ciencias-3b', replaceCourseWork: true }), params())
    expect(response.status).toBe(200)
    expect(mocks.txExecute).toHaveBeenCalledTimes(1)
    expect(mocks.txUpdates).toEqual([
      { table: generatedExams, values: { classroomCourseId: 'ciencias-3b', classroomCourseWorkId: null } },
      { table: examCorrections, values: { gradeReturnedAt: null } },
    ])
    expect(mocks.deleteCourseWork).toHaveBeenCalledWith('token', 'artes-3b', 'cw-artes')
    expect(await response.json()).toMatchObject({ previousCourseWork: { courseId: 'artes-3b', courseWorkId: 'cw-artes', deleted: true } })
  })

  it('considera apagada a atividade que já não existe no Classroom', async () => {
    mocks.deleteCourseWork.mockRejectedValue(notFound())
    const response = await POST(request({ classroomCourseId: 'ciencias-3b', replaceCourseWork: true }), params())
    expect(await response.json()).toMatchObject({ previousCourseWork: { deleted: true } })
  })

  it('mantém a troca e avisa quando o Classroom recusa apagar a atividade antiga', async () => {
    mocks.deleteCourseWork.mockRejectedValue(new Error('forbidden'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const response = await POST(request({ classroomCourseId: 'ciencias-3b', replaceCourseWork: true }), params())
    expect(response.status).toBe(200)
    expect(mocks.txUpdates).toHaveLength(2)
    expect(await response.json()).toMatchObject({ previousCourseWork: { deleted: false } })
  })

  it('não apaga nada sem conexão com o Google, mas troca a turma', async () => {
    mocks.auth.mockResolvedValue({ user: { email: 'marli@colegioharmonia.com.br' } })
    const response = await POST(request({ classroomCourseId: 'ciencias-3b', replaceCourseWork: true }), params())
    expect(response.status).toBe(200)
    expect(mocks.deleteCourseWork).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ previousCourseWork: { deleted: false } })
  })

  it('só permite trocar turma com atividade em prova', async () => {
    mocks.findExam.mockResolvedValue({ ...wrongCourseExam, examKind: 'atividade' })
    const response = await POST(request({ classroomCourseId: 'ciencias-3b', replaceCourseWork: true }), params())
    expect(response.status).toBe(422)
    expect(mocks.txUpdates).toHaveLength(0)
  })

  it('bloqueia professor que não é o responsável pela prova', async () => {
    mocks.findUser.mockResolvedValue({ id: 9, role: 'professor' })
    const response = await POST(request({ classroomCourseId: 'ciencias-3b', replaceCourseWork: true }), params())
    expect(response.status).toBe(403)
    expect(mocks.deleteCourseWork).not.toHaveBeenCalled()
  })

  it('vincula normalmente quando ainda não existe atividade', async () => {
    mocks.findExam.mockResolvedValue({ ...wrongCourseExam, classroomCourseId: null, classroomCourseWorkId: null })
    const response = await POST(request({ classroomCourseId: 'ciencias-3b' }), params())
    expect(response.status).toBe(200)
    expect(mocks.updates).toEqual([{ table: generatedExams, values: { classroomCourseId: 'ciencias-3b' } }])
    expect(mocks.txUpdates).toHaveLength(0)
  })
})
