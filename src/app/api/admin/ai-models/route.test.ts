import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocked = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), profile: vi.fn(), profiles: vi.fn(), save: vi.fn() }))
vi.mock('@/auth/auth', () => ({ auth: mocked.auth }))
vi.mock('@/db/client', () => ({ db: { query: { users: { findFirst: mocked.user }, aiModelProfiles: { findFirst: mocked.profile, findMany: mocked.profiles } } } }))
vi.mock('@/lib/ai/textFallback', () => ({ getTextFallbackModel: vi.fn(), saveTextFallbackModel: mocked.save }))

import { PATCH } from './route'
const request = (value: unknown) => new NextRequest('http://test.local/api/admin/ai-models', { method: 'PATCH', body: JSON.stringify(value) })

describe('configuração explícita da reserva de texto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.auth.mockResolvedValue({ user: { email: 'admin@test.local' } })
    mocked.user.mockResolvedValue({ id: 8, role: 'direcao' })
    mocked.profile.mockResolvedValue({ id: 6, purpose: 'text_generation', provider: 'openai' })
    mocked.profiles.mockResolvedValue([{ enabled: true, provider: 'deepseek' }])
  })
  it('bloqueia alteração por professor', async () => {
    mocked.user.mockResolvedValue({ id: 7, role: 'professor' })
    expect((await PATCH(request({ textFallbackProfileId: 6 }))).status).toBe(403)
    expect(mocked.save).not.toHaveBeenCalled()
  })
  it('salva a escolha da gestão com identidade para auditoria', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    try {
      expect((await PATCH(request({ textFallbackProfileId: 6 }))).status).toBe(200)
      expect(mocked.save).toHaveBeenCalledWith(6, 8)
    } finally { vi.unstubAllEnvs() }
  })
  it('permite desligar a reserva explicitamente', async () => {
    expect((await PATCH(request({ textFallbackProfileId: null }))).status).toBe(200)
    expect(mocked.save).toHaveBeenCalledWith(null, 8)
  })
  it('rejeita modelo de outra finalidade', async () => {
    mocked.profile.mockResolvedValue({ purpose: 'image_generation', provider: 'openai' })
    expect((await PATCH(request({ textFallbackProfileId: 6 }))).status).toBe(400)
    expect(mocked.save).not.toHaveBeenCalled()
  })
  it('rejeita reserva do mesmo provedor', async () => {
    mocked.profiles.mockResolvedValue([{ enabled: true, provider: 'openai' }])
    expect((await PATCH(request({ textFallbackProfileId: 6 }))).status).toBe(400)
    expect(mocked.save).not.toHaveBeenCalled()
  })
})
