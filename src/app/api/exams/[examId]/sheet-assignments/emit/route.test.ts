import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPageQrPayload, createSheetTokenDigest, readSheetQrSigningKeys, verifyPageQrPayload } from '@/lib/scan-sheets/sheetQr'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), authorize: vi.fn(), findMany: vi.fn(), transaction: vi.fn(),
  set: vi.fn(), where: vi.fn(), returning: vi.fn(), insert: vi.fn(), values: vi.fn(), generatePdf: vi.fn(),
}))
vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/corrections/authorize', () => ({ loadExamAndAuthorize: mocks.authorize }))
vi.mock('@/lib/scan-sheets/sheetPdf', () => ({ generateSheetPdf: mocks.generatePdf }))
vi.mock('@/db/client', () => ({ db: {
  query: { examSheetAssignments: { findMany: mocks.findMany } }, transaction: mocks.transaction,
} }))

import { POST } from './route'

const publicId = 'QwErTyUiOpAsDfGhJkLzXcVb'
const signingKeys = readSheetQrSigningKeys(`test=${Buffer.alloc(32, 17).toString('base64url')}`)
const oldTokens = [createPageQrPayload({ publicId, pageNumber: 1, layoutVersion: 'PTR1' }, signingKeys[0])]
const assignment = {
  id: 91, publicId, layoutVersion: 'PTR1', pageCount: 1,
  studentNameSnapshot: 'Estudante de teste', tokenDigest: createSheetTokenDigest(oldTokens),
  examCorrectionId: 81, classroomStudentId: 'student-1', studentEmailSnapshot: null,
}

function request(action: 'emit' | 'download' | 'reprint') {
  return new NextRequest('http://test.local/api/exams/31/sheet-assignments/emit', {
    method: 'POST', body: JSON.stringify({ action }),
  })
}

describe('versão da folha na emissão e no download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SHEET_QR_SIGNING_KEYS', `test=${Buffer.alloc(32, 17).toString('base64url')}`)
    mocks.auth.mockResolvedValue({ user: { email: 'professor@example.test' } })
    mocks.authorize.mockResolvedValue({ currentUser: { id: 9 }, exam: {
      id: 31, status: 'impresso', subject: 'Ciências', gradeYear: 7, academicYear: 2026, bimester: 4,
      generationPayload: { questions: [{ number: 2, type: 'objetiva', alternatives: 'ABCDE'.split('').map((letter) => ({ letter })) }] },
    } })
    mocks.findMany.mockResolvedValue([assignment])
    mocks.generatePdf.mockResolvedValue(new Uint8Array([1, 2, 3]))
    mocks.returning.mockResolvedValue([{ id: assignment.id }])
    mocks.set.mockReturnValue({ where: mocks.where.mockReturnValue({ returning: mocks.returning }) })
    mocks.insert.mockReturnValue({ values: mocks.values.mockResolvedValue(undefined) })
    mocks.transaction.mockImplementation(async (callback) => callback({ update: () => ({ set: mocks.set }), insert: mocks.insert }))
  })
  afterEach(() => vi.unstubAllEnvs())

  it('emite fichas prontas em PTR3 e persiste a mesma versão assinada', async () => {
    const response = await POST(request('emit'), { params: Promise.resolve({ examId: '31' }) })
    expect(response!.status).toBe(200)
    const input = mocks.generatePdf.mock.calls[0][0]
    expect(input).toMatchObject({ examId: 31, layoutVersion: 'PTR3' })
    expect(verifyPageQrPayload(input.qrTokens[0], signingKeys)).toMatchObject({ publicId, layoutVersion: 'PTR3', pageNumber: 1 })
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({
      status: 'emitida', layoutVersion: 'PTR3', tokenDigest: createSheetTokenDigest(input.qrTokens),
    }))
  })

  it.each(['PTR1', 'PTR2', 'PTR3'])('preserva versão e QR de cartões %s já emitidos', async (layoutVersion) => {
    const tokens = [createPageQrPayload({ publicId, pageNumber: 1, layoutVersion }, signingKeys[0])]
    mocks.findMany.mockResolvedValue([{ ...assignment, layoutVersion, tokenDigest: createSheetTokenDigest(tokens) }])
    const response = await POST(request('download'), { params: Promise.resolve({ examId: '31' }) })
    expect(response!.status).toBe(200)
    expect(mocks.generatePdf).toHaveBeenCalledWith(expect.objectContaining({ examId: 31, layoutVersion, qrTokens: tokens }))
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('reimprime no modelo compacto com nova identidade e mantém a referência à emissão substituída', async () => {
    const response = await POST(request('reprint'), { params: Promise.resolve({ examId: '31' }) })
    expect(response!.status).toBe(200)
    const input = mocks.generatePdf.mock.calls[0][0]
    expect(input.layoutVersion).toBe('PTR3')
    expect(input.publicId).not.toBe(publicId)
    expect(verifyPageQrPayload(input.qrTokens[0], signingKeys)).toMatchObject({ publicId: input.publicId, layoutVersion: 'PTR3' })
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'anulada', voidedBy: 9 }))
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      examId: 31, examCorrectionId: 81, classroomStudentId: 'student-1',
      publicId: input.publicId, status: 'emitida', layoutVersion: 'PTR3',
      reprintOfId: assignment.id, tokenDigest: createSheetTokenDigest(input.qrTokens),
    }))
  })

  it('não entrega um ZIP nem cria outra identidade se a emissão original mudou concorrentemente', async () => {
    mocks.returning.mockResolvedValue([])
    const response = await POST(request('reprint'), { params: Promise.resolve({ examId: '31' }) })
    expect(response!.status).toBe(409)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('não troca a assinatura quando o QR original não pode ser recuperado', async () => {
    mocks.findMany.mockResolvedValue([{ ...assignment, tokenDigest: 'digest-indisponivel' }])
    const response = await POST(request('download'), { params: Promise.resolve({ examId: '31' }) })
    expect(response!.status).toBe(409)
    expect(mocks.generatePdf).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
