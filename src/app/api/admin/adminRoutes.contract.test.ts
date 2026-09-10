import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUser: vi.fn(),
  findUsers: vi.fn(),
  findOperations: vi.fn(),
  findProfiles: vi.fn(),
}))

vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
vi.mock('@/db/client', () => ({
  db: {
    query: {
      users: { findFirst: mocks.findUser, findMany: mocks.findUsers },
      aiOperations: { findMany: mocks.findOperations },
      aiModelProfiles: { findMany: mocks.findProfiles },
    },
  },
}))

import { GET as getAiModels } from './ai-models/route'
import { GET as getAiOperations } from './ai-operations/route'
import { GET as getAudit } from './audit/route'
import { GET as getUsers } from '../users/route'

const professor = { id: 7, email: 'professor@colegioharmonia.com.br', role: 'professor' }
const direcao = { id: 8, email: 'direcao@colegioharmonia.com.br', role: 'direcao' }

function session(email = professor.email) {
  return { user: { email } }
}

describe('contratos administrativos de API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejeita auditoria administrativa sem sessao', async () => {
    mocks.auth.mockResolvedValue(null)

    const response = await getAudit()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Não autenticado.' })
    expect(mocks.findUser).not.toHaveBeenCalled()
  })

  it('bloqueia professor na auditoria administrativa', async () => {
    mocks.auth.mockResolvedValue(session())
    mocks.findUser.mockResolvedValue(professor)

    const response = await getAudit()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Sem permissão.' })
  })

  it('permite que direcao consulte o resumo tecnico de IA sem expor prompts', async () => {
    mocks.auth.mockResolvedValue(session(direcao.email))
    mocks.findUser.mockResolvedValue(direcao)
    mocks.findOperations.mockResolvedValue([
      { status: 'succeeded', totalTokens: 120, estimatedCostMicrousd: 35 },
      { status: 'failed', totalTokens: null, estimatedCostMicrousd: null },
    ])
    mocks.findProfiles.mockResolvedValue([])

    const response = await getAiOperations(new NextRequest('http://test.local/api/admin/ai-operations?period=all'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      summary: { total: 2, succeeded: 1, rejected: 0, failed: 1, totalTokens: 120, estimatedCostMicrousd: 35, unpriced: 1 },
      operations: [
        { status: 'succeeded', totalTokens: 120, estimatedCostMicrousd: 35, effectiveCostMicrousd: 35, costStatus: 'recorded' },
        { status: 'failed', totalTokens: null, estimatedCostMicrousd: null, effectiveCostMicrousd: null, costStatus: 'unpriced' },
      ],
    })
  })

  it('mantem perfis de IA inacessiveis sem privilegio administrativo', async () => {
    mocks.auth.mockResolvedValue(session())
    mocks.findUser.mockResolvedValue(professor)

    const response = await getAiModels()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Sem permissão.' })
    expect(mocks.findProfiles).not.toHaveBeenCalled()
  })

  it('permite que direcao leia os perfis de IA', async () => {
    mocks.auth.mockResolvedValue(session(direcao.email))
    mocks.findUser.mockResolvedValue(direcao)
    mocks.findProfiles.mockResolvedValue([{ id: 1, purpose: 'text_generation', provider: 'deepseek', model: 'deepseek-v4-pro' }])

    const response = await getAiModels()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      profiles: [{ id: 1, purpose: 'text_generation', provider: 'deepseek', model: 'deepseek-v4-pro' }],
    })
  })

  it('permite ao professor listar somente usuarios ativos para fluxos de atribuicao', async () => {
    mocks.auth.mockResolvedValue(session())
    mocks.findUsers.mockResolvedValue([{ id: 7, name: 'Professor', email: professor.email, role: 'professor' }])

    const response = await getUsers(new NextRequest('http://test.local/api/users'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      users: [{ id: 7, name: 'Professor', email: professor.email, role: 'professor' }],
    })
    expect(mocks.findUser).not.toHaveBeenCalled()
  })

  it('bloqueia professor de solicitar o cadastro administrativo completo', async () => {
    mocks.auth.mockResolvedValue(session())
    mocks.findUser.mockResolvedValue(professor)

    const response = await getUsers(new NextRequest('http://test.local/api/users?all=1'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Só coordenação/direção pode ver todos os usuários.' })
  })
})
