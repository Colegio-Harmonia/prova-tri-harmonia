import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), fetch: vi.fn() }))
vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
import { GET } from './route'
const html = '<html><head></head><body><div id="results"></div><dialog id="detail"></dialog></body></html>'
const request = () => new NextRequest('https://prova.test/api/exams/manual/browser?subject=Artes&parentOrigin=https%3A%2F%2Fprova.test')
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { email: 'teacher@test.local' } }); vi.stubGlobal('fetch', mocks.fetch) })
afterEach(() => vi.unstubAllGlobals())
describe('integração simples do seletor do banco', () => {
  it('abre o iframe nativo quando o banco suporta o botão de seleção', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(html)).mockResolvedValueOnce(new Response('const pickerOrigin=null;'))
    const response = await GET(request())
    const result = await response.json()
    const url = new URL(result.url)
    expect(url.origin).toBe('https://questoes.colegioharmonia.com.br')
    expect(url.searchParams.get('selecionar')).toBe('1')
    expect(url.searchParams.get('parent_origin')).toBe('https://prova.test')
    expect(url.searchParams.get('disciplina')).toBe('Arte')
  })
  it('mantém o seletor atual enquanto o novo botão do banco não foi publicado', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(html)).mockResolvedValueOnce(new Response('const state=new URLSearchParams(location.search);'))
    const result = await (await GET(request())).json()
    expect(result.html).toContain('Importar esta questão')
    expect(result.url).toBeUndefined()
  })
  it.each(["default-src 'self'; frame-ancestors 'none'", "frame-ancestors https://outro.exemplo"])('usa a alternativa incorporada quando o cabeçalho bloqueia a Prova-Tri: %s', async (policy) => {
    mocks.fetch.mockResolvedValueOnce(new Response(html, { headers: { 'Content-Security-Policy': policy } })).mockResolvedValueOnce(new Response('const pickerOrigin=null;'))
    const result = await (await GET(request())).json()
    expect(result.url).toBeUndefined()
    expect(result.html).toContain('Importar esta questão')
  })
  it('abre diretamente quando o cabeçalho autoriza a origem da Prova-Tri', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(html, { headers: { 'Content-Security-Policy': 'frame-ancestors https://prova.test' } })).mockResolvedValueOnce(new Response('const pickerOrigin=null;'))
    expect((await (await GET(request())).json()).url).toContain('selecionar=1')
  })
  it('não acessa o banco sem autenticação', async () => {
    mocks.auth.mockResolvedValue(null)
    expect((await GET(request())).status).toBe(401)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
