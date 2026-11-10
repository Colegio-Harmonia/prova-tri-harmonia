import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
const mocks = vi.hoisted(() => ({ rows: vi.fn(), predicates: [] as unknown[] }))
vi.mock('@/db/client', () => ({ db: { select: () => ({ from: () => ({ where: (predicate: unknown) => { mocks.predicates.push(predicate); return { orderBy: mocks.rows } } }) }) } }))
import { loadManualPlanningGuide } from './manualPlanningGuide'
const scope = { academicYear: 2026, segment: 'ensino-medio' as const, gradeYear: 1, subject: 'Artes' }
const sql = (index: number) => new PgDialect().sqlToQuery(mocks.predicates[index] as Parameters<PgDialect['sqlToQuery']>[0])
beforeEach(() => { vi.clearAllMocks(); mocks.predicates.length = 0 })
describe('guia de conteúdo para criação manual', () => {
  it('consulta o ano letivo, segmento e série da prova e filtra a disciplina', async () => {
    mocks.rows.mockResolvedValueOnce([{ id: 9, subject: 'Física', bimester: 1 }])
    expect(await loadManualPlanningGuide(scope)).toEqual({ plans: [] })
    expect(sql(0).params).toEqual([2026, 'ensino-medio', 1])
    expect(mocks.rows).toHaveBeenCalledTimes(1)
  })
  it('mostra somente a versão aprovada mais recente e mantém objetivos mesmo sem BNCC', async () => {
    mocks.rows.mockResolvedValueOnce([{ id: 1, subject: 'Artes', bimester: 1 }, { id: 2, subject: 'Artes', bimester: 3 }])
      .mockResolvedValueOnce([{ id: 12, planId: 1, versionNumber: 2 }, { id: 11, planId: 1, versionNumber: 1 }, { id: 23, planId: 2, versionNumber: 3 }])
      .mockResolvedValueOnce([{ id: 100, versionId: 12, title: 'Arte e cultura', content: 'Linguagens artísticas', objectives: 'Interpretar manifestações culturais.' }, { id: 200, versionId: 23, title: 'Patrimônio', content: null, objectives: null }])
      .mockResolvedValueOnce([{ unitId: 200, code: 'EM13LGG601', description: 'Apreciar manifestações artísticas.' }])
    const guide = await loadManualPlanningGuide(scope)
    expect(sql(1).params).toContain('aprovado')
    expect(sql(2).params).toEqual([12, 23])
    expect(guide.plans.map((plan) => plan.bimester)).toEqual([1, 3])
    expect(guide.plans[0].units[0]).toMatchObject({ title: 'Arte e cultura', objectives: 'Interpretar manifestações culturais.', skills: [] })
    expect(guide.plans[1].units[0].skills).toEqual([{ code: 'EM13LGG601', description: 'Apreciar manifestações artísticas.' }])
  })
  it('não usa rascunhos quando não existe versão aprovada', async () => {
    mocks.rows.mockResolvedValueOnce([{ id: 1, subject: 'Artes', bimester: 1 }]).mockResolvedValueOnce([])
    expect(await loadManualPlanningGuide(scope)).toEqual({ plans: [] })
    expect(mocks.rows).toHaveBeenCalledTimes(2)
  })
})
