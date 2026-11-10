import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), findUser: vi.fn(), get: vi.fn(), save: vi.fn() }))
vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
vi.mock('@/db/client', () => ({ db: { query: { users: { findFirst: mocks.findUser } } } }))
vi.mock('@/lib/settings/acervoSettings', () => ({ getAcervoApiUrl: mocks.get, saveAcervoApiUrl: mocks.save }))
import { GET, PUT } from './route'

const request = (body: string) => new NextRequest('http://test.local/api/admin/settings/acervo', { method: 'PUT', body })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ user: { email: 'admin@example.com' } })
  mocks.findUser.mockResolvedValue({ id: 8, role: 'direcao', active: true })
  mocks.get.mockResolvedValue('http://acervo.local:5000')
  mocks.save.mockImplementation(async (value: string) => value)
})

describe('configuração administrativa do acervo', () => {
  it.each([null, { id: 1, role: 'professor', active: true }, { id: 8, role: 'direcao', active: false }])
    ('bloqueia consulta e gravação sem administrador ativo: %j', async (user) => {
      mocks.findUser.mockResolvedValue(user)
      expect((await GET()).status).toBe(403)
      expect((await PUT(request('{"url":"192.168.1.1:5000"}'))).status).toBe(403)
      expect(mocks.get).not.toHaveBeenCalled()
      expect(mocks.save).not.toHaveBeenCalled()
    })

  it('bloqueia acesso sem sessão', async () => {
    mocks.auth.mockResolvedValue(null)
    expect((await GET()).status).toBe(403)
    expect(mocks.findUser).not.toHaveBeenCalled()
  })

  it.each(['direcao', 'coordenacao'])('permite leitura e gravação por %s', async (role) => {
    mocks.findUser.mockResolvedValue({ id: 8, role, active: true })
    const response = await GET()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ url: 'http://acervo.local:5000' })
    const saved = await PUT(request('{"url":"192.168.1.100:5001"}'))
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ url: 'http://192.168.1.100:5001' })
    expect(mocks.save).toHaveBeenCalledWith('http://192.168.1.100:5001', 8)
  })

  it.each(['invalid json', '{}', '{"url":"https://user:password@acervo.local"}'])
    ('recusa payload inválido sem alterar configuração', async (body) => {
      expect((await PUT(request(body))).status).toBe(400)
      expect(mocks.save).not.toHaveBeenCalled()
    })
})
