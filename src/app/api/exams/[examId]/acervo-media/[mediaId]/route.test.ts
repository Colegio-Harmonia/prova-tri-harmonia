import { NextRequest, NextResponse } from 'next/server'
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn() }))
vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/exams/authorizeExamAccess', () => ({ authorizeExamAccess: mocks.access }))
vi.mock('@/lib/settings/acervoSettings', () => ({ getAcervoApiUrl: async () => 'http://acervo.local:5000' }))
import { GET } from './route'

const request = new NextRequest('http://test.local/api/exams/489/acervo-media/1000000076239')
const params = { params: Promise.resolve({ examId: '489', mediaId: '1000000076239' }) }
let png: Buffer
beforeAll(async () => { png = await sharp({ create: { width: 10, height: 10, channels: 4, background: 'white' } }).png().toBuffer() })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { email: 'teacher@example.com' } })
  mocks.access.mockResolvedValue({ exam: { generationPayload: { questions: [{ source: 'acervo', acervoRef: { original: { midias: [{ id: 1000000076239, local: 'resolucao' }] } } }] } } })
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } })))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('mídia original do acervo na revisão', () => {
  it('serve a fórmula da resolução somente depois de autorizar o acesso à prova', async () => {
    const response = await GET(request, params)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect([...new Uint8Array(await response.arrayBuffer()).slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(mocks.access).toHaveBeenCalledWith(489, 'teacher@example.com')
    expect(vi.mocked(fetch).mock.calls[0]![0].toString()).toBe('http://acervo.local:5000/api/media/1000000076239')
  })
  it('aceita o PNG original da resolução mesmo com o cabeçalho genérico da API', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(new Uint8Array(png), { headers: { 'Content-Type': 'binary/octet-stream' } }))
    const response = await GET(request, params)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
    expect(metadata).toMatchObject({ format: 'png', width: 10, height: 10 })
  })
  it('não consulta a mídia sem autenticação', async () => {
    mocks.auth.mockResolvedValue(null)
    expect((await GET(request, params)).status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('não consulta mídia de outra prova ou não registrada no original', async () => {
    expect((await GET(request, { params: Promise.resolve({ examId: '489', mediaId: '123' }) })).status).toBe(404)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('respeita a recusa de acesso à prova', async () => {
    mocks.access.mockResolvedValue({ error: NextResponse.json({ error: 'Sem acesso' }, { status: 403 }) })
    expect((await GET(request, params)).status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('não serve como imagem uma resposta HTML de erro do acervo', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Erro', { headers: { 'Content-Type': 'text/html' } }))
    expect((await GET(request, params)).status).toBe(502)
  })
})
