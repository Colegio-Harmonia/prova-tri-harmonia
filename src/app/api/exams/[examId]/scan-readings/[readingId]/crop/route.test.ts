import { NextRequest, NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), authorize: vi.fn(), select: vi.fn(), insert: vi.fn(), values: vi.fn(), download: vi.fn(), stream: vi.fn(), crop: vi.fn() }))
vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/corrections/authorize', () => ({ loadExamAndAuthorize: mocks.authorize }))
vi.mock('@/lib/scan-ingest/privateScanContent', () => ({ downloadPrivateScanBytes: mocks.download, openPrivateScanStream: mocks.stream }))
vi.mock('@/lib/scan-ingest/discursiveOcr', () => ({ cropDiscursiveAnswer: mocks.crop }))
vi.mock('@/db/client', () => ({ db: { select: mocks.select, insert: mocks.insert } }))

import { GET } from './route'

const row = { driveFileId: 'old-truncated-crop', mimeType: 'image/jpeg', uploadId: 10, kind: 'discursive', questionNumber: 3, sheetPageNumber: 1, canonicalDriveFileId: 'complete-page', exceptionCode: null }
async function request() {
  const response = await GET(new NextRequest('http://test.local/api/exams/761/scan-readings/29600/crop'), { params: Promise.resolve({ examId: '761', readingId: '29600' }) })
  if (!response) throw new Error('Resposta HTTP ausente')
  return response
}
function reading(value: Omit<typeof row, 'driveFileId' | 'mimeType'> & { driveFileId: string | null; mimeType: string | null }) {
  const query = { from: () => query, innerJoin: () => query, where: () => query, limit: vi.fn().mockResolvedValue([value]) }
  mocks.select.mockReturnValue(query)
}

describe('recorte completo de scans existentes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { email: 'teacher@example.test' } })
    mocks.authorize.mockResolvedValue({ currentUser: { id: 1 }, exam: { generationPayload: { questions: [2, 3, 4].map((number) => ({ number, type: 'descritiva' })) } } })
    reading(row)
    mocks.download.mockResolvedValue(Buffer.from('canonical'))
    mocks.crop.mockResolvedValue(Buffer.from('full-box'))
    mocks.insert.mockReturnValue({ values: mocks.values.mockResolvedValue(undefined) })
  })

  it('recalcula o quadro da questão correta a partir da página original, sem usar o recorte truncado', async () => {
    const response = await request()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('full-box')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.download).toHaveBeenCalledWith('complete-page')
    expect(mocks.crop).toHaveBeenCalledWith({ canonicalImage: Buffer.from('canonical'), questionIndex: 1, questionsOnPage: 3 })
    expect(mocks.stream).not.toHaveBeenCalled()
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ metadata: { readingId: 29600, fullBox: true } }))
  })

  it('também mostra o quadro quando o recorte anterior ainda não foi arquivado', async () => {
    reading({ ...row, driveFileId: null, mimeType: null })
    expect((await request()).status).toBe(200)
    expect(mocks.crop).toHaveBeenCalledOnce()
  })

  it('recusa questão que não pertence à página', async () => {
    reading({ ...row, questionNumber: 8 })
    expect((await request()).status).toBe(422)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('preserva a autorização antes de ler imagens privadas', async () => {
    mocks.authorize.mockResolvedValue({ error: NextResponse.json({ error: 'Sem acesso' }, { status: 403 }) })
    expect((await request()).status).toBe(403)
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
  })
})
