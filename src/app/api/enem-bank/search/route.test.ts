import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), execute: vi.fn() }))
vi.mock('@/auth/auth', () => ({ auth: mocks.auth }))
vi.mock('@/db/client', () => ({ db: { execute: mocks.execute } }))
import { GET } from './route'

beforeEach(() => {
  mocks.auth.mockResolvedValue({ user: { id: '1' } })
  mocks.execute.mockResolvedValue([])
  mocks.execute.mockClear()
})

describe('busca de provas ENEM', () => {
  it('busca itens de inglês explicitamente e recusa uma disciplina de outra área', async () => {
    await GET(new NextRequest('http://localhost/api/enem-bank/search?area=linguagens&subject=Ingl%C3%AAs'))
    const { PgDialect } = await import('drizzle-orm/pg-core')
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0])
    expect(query.params).toContain('ingles')
    expect((await GET(new NextRequest('http://localhost/api/enem-bank/search?area=matematica&subject=Ingl%C3%AAs'))).status).toBe(400)
  })
  it('exige autenticação', async () => {
    mocks.auth.mockResolvedValue(null)
    expect((await GET(new NextRequest('http://localhost/api/enem-bank/search?area=matematica'))).status).toBe(401)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it.each(['year=abc', 'year=1990', 'limit=-1', 'limit=NaN', 'offset=-1', 'questionIndex=181'])('rejeita filtro inválido: %s', async (query) => {
    expect((await GET(new NextRequest(`http://localhost/api/enem-bank/search?area=matematica&${query}`))).status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('aplica ano, número, texto e paginação por parâmetros SQL', async () => {
    await GET(new NextRequest('http://localhost/api/enem-bank/search?area=matematica&year=2023&questionIndex=150&q=glicose&offset=40'))
    const { PgDialect } = await import('drizzle-orm/pg-core')
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0])
    expect(query.sql).toContain("q.source = 'enem'")
    expect(query.sql).toContain('q.year = $')
    expect(query.sql).toContain('q.question_index = $')
    expect(query.params).toEqual(['matematica', '', 2023, 150, '%glicose%', 41, 40])
  })
  it('sinaliza outra página sem duplicar o item de controle', async () => {
    mocks.execute.mockResolvedValue([{ id: 1, year: 2023, question_index: 150, context: 'Primeira' }, { id: 2, year: 2023, question_index: 151, context: 'Segunda' }])
    const response = await GET(new NextRequest('http://localhost/api/enem-bank/search?area=matematica&limit=1'))
    expect(await response.json()).toMatchObject({ hasMore: true, questions: [{ id: 1, year: 2023, questionIndex: 150 }] })
  })
})
