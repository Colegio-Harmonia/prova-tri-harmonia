import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUser: vi.fn(),
}))

vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
vi.mock('@/db/client', () => ({
  db: {
    query: { users: { findFirst: mocks.findUser } },
  },
}))

import { GET } from './enem-sae/route'

const professor = { id: 7, email: 'professor@colegioharmonia.com.br', role: 'professor' }
const coordenacao = { id: 8, email: 'coordenacao@colegioharmonia.com.br', role: 'coordenacao' }

function request(query = '') {
  return new NextRequest(`http://test.local/api/analytics/enem-sae${query}`)
}

describe('contrato da analise ENEM-SAE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejeita consulta sem sessao', async () => {
    mocks.auth.mockResolvedValue(null)

    const response = await GET(request())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Não autenticado.' })
  })

  it('bloqueia professor antes de consultar importacoes institucionais', async () => {
    mocks.auth.mockResolvedValue({ user: { email: professor.email } })
    mocks.findUser.mockResolvedValue(professor)

    const response = await GET(request('?academicYear=2026'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Sem permissão.' })
  })

  it('valida ano letivo apos autorizar coordenacao', async () => {
    mocks.auth.mockResolvedValue({ user: { email: coordenacao.email } })
    mocks.findUser.mockResolvedValue(coordenacao)

    const response = await GET(request('?academicYear=1999'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Ano letivo inválido.' })
  })
})
