import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUser: vi.fn(),
  transaction: vi.fn(),
  execute: vi.fn(),
  transactionExecute: vi.fn(),
  delete: vi.fn(),
  deleteChatWhere: vi.fn(),
  deleteUserWhere: vi.fn(),
  returning: vi.fn(),
  insert: vi.fn(),
  auditValues: vi.fn(),
}))

vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
vi.mock('@/db/client', () => ({
  db: {
    query: { users: { findFirst: mocks.findUser } },
    transaction: mocks.transaction,
    execute: mocks.execute,
  },
}))

import { DELETE } from './route'

const admin = { id: 1, email: 'admin@colegioharmonia.com.br', role: 'direcao' }
const target = { id: 9, name: 'Teste', email: 'teste@colegioharmonia.com.br', role: 'professor', active: true }
const request = new NextRequest('http://test.local/api/users/9', { method: 'DELETE' })
const params = { params: Promise.resolve({ id: '9' }) }

describe('DELETE /api/users/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ user: { email: admin.email } })
    mocks.findUser.mockResolvedValueOnce(admin).mockResolvedValueOnce(target)
    mocks.delete.mockImplementationOnce(() => ({ where: mocks.deleteChatWhere }))
    mocks.deleteChatWhere.mockResolvedValue(undefined)
    mocks.delete.mockImplementationOnce(() => ({ where: mocks.deleteUserWhere }))
    mocks.deleteUserWhere.mockReturnValue({ returning: mocks.returning })
    mocks.returning.mockResolvedValue([{ id: target.id, name: target.name, email: target.email }])
    mocks.insert.mockReturnValue({ values: mocks.auditValues })
    mocks.auditValues.mockResolvedValue(undefined)
    mocks.execute.mockResolvedValue([])
    mocks.transactionExecute.mockResolvedValue(undefined)
    mocks.transaction.mockImplementation(async (callback) => callback({ delete: mocks.delete, insert: mocks.insert, execute: mocks.transactionExecute }))
  })

  it('impede excluir a própria conta', async () => {
    mocks.findUser.mockReset()
    mocks.findUser.mockResolvedValue({ ...admin, id: target.id })

    const response = await DELETE(request, params)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Você não pode excluir sua própria conta.' })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('exclui conta sem histórico e registra auditoria', async () => {
    const response = await DELETE(request, params)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ user: { id: 9, name: 'Teste', email: 'teste@colegioharmonia.com.br' } })
    expect(mocks.auditValues).toHaveBeenCalledWith(expect.objectContaining({
      action: 'user_deleted',
      actorId: admin.id,
      targetUserId: target.id,
      previousValue: { name: target.name, email: target.email, role: target.role, active: target.active },
    }))
  })

  it('orienta desativação quando o histórico impede a exclusão', async () => {
    // Em produção o Drizzle encapsula a violação de FK em `cause`.
    mocks.transaction.mockRejectedValue({ cause: { code: '23503' } })

    const response = await DELETE(request, params)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Esta conta possui histórico no sistema e não pode ser excluída. Desative o acesso para preservar os registros.',
    })
  })

  it('pede o usuário que receberá o histórico antes de excluir', async () => {
    mocks.execute.mockResolvedValue([{ count: 1 }])

    const response = await DELETE(request, params)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      requiresTransfer: true,
      history: expect.objectContaining({ records: expect.any(Number), exams: expect.any(Number) }),
    }))
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('transfere os vínculos antes de excluir a conta', async () => {
    const recipient = { id: 11, name: 'Coordenação', email: 'coord@colegioharmonia.com.br', role: 'coordenacao', active: true }
    mocks.findUser.mockReset()
    mocks.findUser.mockResolvedValueOnce(admin).mockResolvedValueOnce(target).mockResolvedValueOnce(recipient)
    mocks.execute.mockResolvedValue([{ count: 1 }])
    const transferRequest = new NextRequest('http://test.local/api/users/9', {
      method: 'DELETE',
      body: JSON.stringify({ transferToUserId: recipient.id }),
    })

    const response = await DELETE(transferRequest, params)

    expect(response.status).toBe(200)
    expect(mocks.transactionExecute).toHaveBeenCalled()
    expect(mocks.auditValues).toHaveBeenCalledWith(expect.objectContaining({
      action: 'user_deleted',
      nextValue: expect.objectContaining({ transferredToUserId: recipient.id, transferredToName: recipient.name }),
    }))
  })
})
