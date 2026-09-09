import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ post: vi.fn(), isAxiosError: vi.fn() }))

vi.mock('axios', () => ({
  default: {
    post: mocks.post,
    isAxiosError: mocks.isAxiosError,
  },
}))

import { createCourseWorkWithLinkMaterial, summarizeClassroomApiError } from './classroomClient'

describe('summarizeClassroomApiError', () => {
  it('keeps only safe provider identifiers for an Axios Classroom error', () => {
    mocks.isAxiosError.mockReturnValue(true)
    expect(summarizeClassroomApiError({ response: { status: 403, data: { error: { status: 'PERMISSION_DENIED', details: [{ reason: 'PERMISSION_DENIED' }], message: 'private provider detail' } } } })).toEqual({
      httpStatus: 403,
      googleStatus: 'PERMISSION_DENIED',
      reason: 'PERMISSION_DENIED',
    })
  })
})

describe('createCourseWorkWithLinkMaterial', () => {
  beforeEach(() => {
    mocks.post.mockReset()
    mocks.post.mockResolvedValue({ data: { id: 'atividade-1', alternateLink: 'https://classroom.google.com/c/atividade-1' } })
  })

  it('uses the shared PDF link when native Drive attachment sharing is rejected', async () => {
    await expect(createCourseWorkWithLinkMaterial('token', 'curso-1', { title: 'Atividade', description: 'Descrição', maxPoints: 4, state: 'DRAFT', url: 'https://drive.google.com/open?id=arquivo-1', linkTitle: 'Atividade.pdf' })).resolves.toEqual({ id: 'atividade-1', alternateLink: 'https://classroom.google.com/c/atividade-1' })

    expect(mocks.post).toHaveBeenCalledWith(
      'https://classroom.googleapis.com/v1/courses/curso-1/courseWork',
      { title: 'Atividade', description: 'Descrição', workType: 'ASSIGNMENT', maxPoints: 4, state: 'DRAFT', materials: [{ link: { url: 'https://drive.google.com/open?id=arquivo-1', title: 'Atividade.pdf' } }] },
      { headers: { Authorization: 'Bearer token' } },
    )
  })
})
