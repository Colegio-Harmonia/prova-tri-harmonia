import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  loadExamAndAuthorize: vi.fn(),
  purgeExamScanData: vi.fn(),
}))

vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/corrections/authorize', () => ({ loadExamAndAuthorize: mocks.loadExamAndAuthorize }))
vi.mock('@/lib/scan-ingest/purgeExamScanData', () => ({ purgeExamScanData: mocks.purgeExamScanData }))

import { DELETE } from './route'

function request(confirmation: unknown) {
  return new NextRequest('http://test.local/api/exams/261/purge-scans', {
    method: 'DELETE',
    body: JSON.stringify({ confirmation }),
    headers: { 'Content-Type': 'application/json' },
  })
}

function params() {
  return { params: Promise.resolve({ examId: '261' }) }
}

describe('limpeza de scans da prova', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { email: 'coord@colegioharmonia.com.br' } })
    mocks.loadExamAndAuthorize.mockResolvedValue({
      currentUser: { id: 9, role: 'coordenacao' },
      exam: { id: 261 },
    })
    mocks.purgeExamScanData.mockResolvedValue({ examId: 261, uploads: 2, pages: 4, readings: 20, attempts: 2, auditEvents: 6, jobs: 3, correctionsReset: 2, classificationsRemoved: 20 })
  })

  it('exige a confirmação literal CONFIRMO', async () => {
    const response = await DELETE(request('confirmo'), params())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Digite CONFIRMO exatamente para confirmar a limpeza.' })
    expect(mocks.purgeExamScanData).not.toHaveBeenCalled()
  })

  it('limpa somente o ID da prova autorizado', async () => {
    const response = await DELETE(request('CONFIRMO'), params())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: expect.objectContaining({ examId: 261, correctionsReset: 2 }),
    })
    expect(mocks.loadExamAndAuthorize).toHaveBeenCalledWith(261, 'coord@colegioharmonia.com.br')
    expect(mocks.purgeExamScanData).toHaveBeenCalledWith(261)
  })
})
