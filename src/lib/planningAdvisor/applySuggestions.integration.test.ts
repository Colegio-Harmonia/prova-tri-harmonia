// Integração contra Postgres real (PGlite), no mesmo molde de
// planningService.integration.test.ts: as sugestões só entram em rascunho e
// respeitam as travas do planejamento.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb, pgliteInstalled } from '@/test/pgliteDb'

const state: { db?: unknown } = {}
vi.mock('@/db/client', () => ({ get db() { return state.db } }))
vi.mock('@/lib/curriculum/bnccDescriptions', () => ({
  enrichBnccDescriptions: async <T extends { code: string; description: string | null }>(skills: T[]) => skills.map((skill) => ({ ...skill, description: skill.description ?? `Oficial ${skill.code}` })),
}))

describe.skipIf(!pgliteInstalled())('applyEnemSuggestions (Postgres real)', () => {
  let planning: typeof import('@/lib/curriculum/planningService')
  let advisor: typeof import('./applySuggestions')
  const coord = { id: 1, role: 'coordenacao' as const }
  const prof = { id: 2, role: 'professor' as const }
  const other = { id: 3, role: 'professor' as const }
  const scope = { academicYear: 2027, segment: 'ensino-medio' as const, gradeYear: 2, subject: 'Matemática' }
  const item = (codes: string[], title = 'Arcos') => ({ ...scope, items: [{ bimester: 1, title, codes }] })
  let planId: number

  async function enemOf(versionId?: number) {
    const detail = await planning.getPlanDetail(coord, planId, versionId)
    return { detail, enem: detail.units.map((unit) => unit.enemSkills) }
  }

  beforeAll(async () => {
    const created = await createTestDb()
    await created.pg.exec(`insert into users (id, name, email, role) values (1, 'Coord', 'c@x', 'coordenacao'), (2, 'Prof A', 'a@x', 'professor'), (3, 'Prof B', 'b@x', 'professor')`)
    state.db = created.db
    planning = await import('@/lib/curriculum/planningService')
    advisor = await import('./applySuggestions')
    const plan = await planning.createPlan(coord, { ...scope, bimester: 1 })
    planId = plan.planId
    await planning.setAssignment(coord, planId, prof.id, 'responsavel')
    await planning.saveDraft(coord, plan.versionId, [
      { title: 'Arcos', content: 'Medidas de arcos', skills: [{ code: 'EM13MAT306' }], enemSkills: 'C2:H7' },
      { title: 'Trigonometria na circunferência', skills: [] },
    ])
  }, 60_000)

  it('avisa quando o bimestre não tem planejamento', async () => {
    const { results } = await advisor.applyEnemSuggestions(prof, { ...scope, items: [{ bimester: 3, title: 'Arcos', codes: ['C4:H15'] }] })
    expect(results[0]).toMatchObject({ bimester: 3, status: 'sem_planejamento', planId: null })
  })

  it('professor responsável adiciona ao rascunho aberto, sem duplicar nem aceitar código inválido', async () => {
    const { results } = await advisor.applyEnemSuggestions(prof, item(['C4:H15', 'C2:H7', 'C9:H99']))
    expect(results[0]).toMatchObject({ status: 'aplicado', versionNumber: 1, applied: [{ title: 'Arcos', codes: ['C4:H15'] }] })
    const { detail, enem } = await enemOf()
    expect(enem).toEqual(['C2:H7\nC4:H15', null])
    expect(detail.versions.map((version) => version.status)).toEqual(['rascunho'])
    expect(detail.units[0].skills.map((skill) => skill.code)).toEqual(['EM13MAT306'])

    const again = await advisor.applyEnemSuggestions(prof, item(['C4:H15']))
    expect(again.results[0]).toMatchObject({ status: 'sem_mudanca', applied: [] })
  })

  it('não grava nada para capítulo inexistente nem para professor sem acesso', async () => {
    const missing = await advisor.applyEnemSuggestions(prof, item(['C5:H21'], 'Logaritmos'))
    expect(missing.results[0]).toMatchObject({ status: 'sem_mudanca', notFound: ['Logaritmos'] })
    const denied = await advisor.applyEnemSuggestions(other, item(['C5:H21']))
    expect(denied.results[0]).toMatchObject({ status: 'bloqueado' })
    expect((await enemOf()).enem).toEqual(['C2:H7\nC4:H15', null])
  })

  it('bloqueia enquanto a versão está em revisão', async () => {
    const { detail } = await enemOf()
    await planning.transitionVersion(prof, detail.selectedVersionId!, 'em_revisao')
    const { results } = await advisor.applyEnemSuggestions(coord, item(['C5:H21']))
    expect(results[0]).toMatchObject({ status: 'bloqueado' })
    expect(results[0].message).toContain('em revisão')
    await planning.transitionVersion(coord, detail.selectedVersionId!, 'aprovado')
  })

  it('com versão aprovada, abre nova versão em rascunho e deixa a oficial intacta', async () => {
    const official = (await enemOf()).detail.officialVersionId!
    const { results } = await advisor.applyEnemSuggestions(prof, item(['C5:H21'], 'Trigonometria na circunferência'))
    expect(results[0]).toMatchObject({ status: 'aplicado', versionNumber: 2 })
    expect((await enemOf(official)).enem).toEqual(['C2:H7\nC4:H15', null])
    const { detail, enem } = await enemOf()
    expect(detail.versions.map((version) => version.status)).toEqual(['aprovado', 'rascunho'])
    expect(enem).toEqual(['C2:H7\nC4:H15', 'C5:H21'])
  })

  it('grava só o campo ENEM das unidades-alvo, sem regravar o resto do rascunho', async () => {
    const { detail } = await enemOf()
    const draftId = detail.selectedVersionId!
    // Outro responsável edita o rascunho (conteúdo, BNCC e uma unidade nova)...
    await planning.saveDraft(coord, draftId, [
      { title: 'Arcos', content: 'Conteúdo revisto pela coordenação', skills: [{ code: 'EM13MAT306' }, { code: 'EM13MAT308' }], enemSkills: 'C2:H7\nC4:H15' },
      { title: 'Trigonometria na circunferência', skills: [], enemSkills: 'C5:H21' },
      { title: 'Funções trigonométricas', skills: [] },
    ])
    // ...e a gravação do Assistente, calculada dentro da transação, não desfaz nada disso.
    let seenInsideTx: string[] = []
    await planning.patchDraftEnemSkills(prof, draftId, (units) => {
      seenInsideTx = units.map((unit) => unit.title)
      const planned = advisor.planChanges(units, [{ bimester: 1, title: 'Funções trigonométricas', codes: ['C5:H20'] }], 'matematica')
      return { changes: planned.changes, summary: 'teste', result: planned }
    })
    expect(seenInsideTx).toEqual(['Arcos', 'Trigonometria na circunferência', 'Funções trigonométricas'])
    const after = await enemOf()
    expect(after.enem).toEqual(['C2:H7\nC4:H15', 'C5:H21', 'C5:H20'])
    expect(after.detail.units[0].content).toBe('Conteúdo revisto pela coordenação')
    expect(after.detail.units[0].skills.map((skill) => skill.code)).toEqual(['EM13MAT306', 'EM13MAT308'])
  })

  it('patch recusa versão que não é rascunho e código inválido', async () => {
    const official = (await enemOf()).detail.officialVersionId!
    await expect(planning.patchDraftEnemSkills(coord, official, () => ({ changes: [], summary: '', result: null }))).rejects.toThrow(/rascunho/)
    const draftId = (await enemOf()).detail.selectedVersionId!
    await expect(planning.patchDraftEnemSkills(coord, draftId, (units) => ({ changes: [{ unitId: units[0].id, enemSkills: 'C9:H99' }], summary: '', result: null }))).rejects.toThrow(/inválidas/)
    expect((await enemOf()).enem[0]).toBe('C2:H7\nC4:H15')
  })

  it('recusa fora do Ensino Médio', async () => {
    await expect(advisor.applyEnemSuggestions(coord, { ...item(['C1:H1']), segment: 'anos-finais', gradeYear: 9 })).rejects.toThrow(/Ensino Médio/)
  })
})
