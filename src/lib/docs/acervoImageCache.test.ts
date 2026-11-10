import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
const mocks = vi.hoisted(() => ({ upload: vi.fn() }))
vi.mock('@/lib/images/questionImageService', () => ({ uploadToStaging: mocks.upload }))
vi.mock('@/lib/settings/acervoSettings', () => ({ getAcervoApiUrl: async () => 'http://acervo.local' }))
import { buildAcervoImageCache } from './acervoImageCache'
const exam = { questions: [{ source: 'acervo', acervoRef: { original: { midias: [{ id: 10, local: 'enunciado' }, { id: 100, local: 'resolucao' }] } }, acervoInlineContent: { statement: [{ type: 'image', mediaId: 10 }] } }] } as unknown as ExamGenerationResult
let png: Buffer
beforeAll(async () => { png = await sharp({ create: { width: 10, height: 10, channels: 4, background: 'white' } }).png().toBuffer() })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.upload.mockResolvedValue({ driveFileId: 'original', width: 100, height: 30 })
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(new Uint8Array(png), { headers: { 'Content-Type': 'binary/octet-stream' } })))
})
afterEach(() => vi.unstubAllGlobals())
describe('imagens originais nos documentos', () => {
  it('não baixa a imagem da resposta se uma apresentação desatualizada a marcar como enunciado', async () => {
    const altered = { ...exam, questions: [{ ...exam.questions[0]!, acervoInlineContent: { statement: [{ type: 'image' as const, mediaId: 100, alt: '' }] } }] }
    expect((await buildAcervoImageCache(altered, 'inline')).size).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('baixa para a prova somente a fórmula do enunciado, sem a resposta', async () => {
    const cache = await buildAcervoImageCache(exam, 'inline')
    expect([...cache.keys()]).toEqual([10])
    expect(vi.mocked(fetch).mock.calls[0]![0].toString()).toBe('http://acervo.local/api/media/10')
  })
  it('baixa para o gabarito a imagem da resolução', async () => {
    const cache = await buildAcervoImageCache(exam, 'resolucao')
    expect([...cache.keys()]).toEqual([100])
    expect(vi.mocked(fetch).mock.calls[0]![0].toString()).toBe('http://acervo.local/api/media/100')
  })
})
