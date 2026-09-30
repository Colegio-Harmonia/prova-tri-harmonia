// Teste de integração do planejamento (Bloco 7) contra Postgres real (PGlite,
// em memória). Aplica as migrations do projeto que criam `users` e as tabelas
// `curriculum_*`. PGlite é devDependency (roda no CI); se faltar, o teste é pulado.

import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

let pgliteAvailable = true
try { require.resolve('@electric-sql/pglite') } catch { pgliteAvailable = false }

const state: { db?: unknown } = {}
vi.mock('@/db/client', () => ({ get db() { return state.db } }))
vi.mock('./bnccDescriptions', () => ({
  enrichBnccDescriptions: async <T extends { code: string; description: string | null }>(skills: T[]) => skills.map((skill) => ({ ...skill, description: skill.description ?? `Oficial ${skill.code}` })),
}))

describe.skipIf(!pgliteAvailable)('planningService (Postgres real)', () => {
  let service: typeof import('./planningService')
  const coord = { id: 1, role: 'coordenacao' as const }
  const prof = { id: 2, role: 'professor' as const }
  const other = { id: 3, role: 'professor' as const }

  beforeAll(async () => {
    const { PGlite } = await import('@electric-sql/pglite')
    const { drizzle } = await import('drizzle-orm/pglite')
    const schema = await import('@/db/schema')
    const pg = new PGlite()
    const dir = path.join(process.cwd(), 'drizzle')
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
      // Algumas migrations antigas dependem de tabelas criadas fora da cadeia; não afetam as tabelas usadas aqui.
      await pg.exec(fs.readFileSync(path.join(dir, file), 'utf8').replace(/-->\s*statement-breakpoint/g, '')).catch(() => undefined)
    }
    await pg.exec(`insert into users (id, name, email, role) values (1, 'Coord', 'c@x', 'coordenacao'), (2, 'Prof A', 'a@x', 'professor'), (3, 'Prof B', 'b@x', 'professor')`)
    state.db = drizzle(pg, { schema })
    service = await import('./planningService')
  }, 60_000)

  it('ciclo completo: criar, atribuir, editar, revisar, devolver, aprovar, travar, nova versão, encerrar', async () => {
    const scope = { academicYear: 2027, segment: 'anos-iniciais' as const, gradeYear: 5, subject: 'Matemática', bimester: 1 }
    await expect(service.createPlan(prof, scope)).rejects.toThrow(/coordenação/)
    const { planId, versionId } = await service.createPlan(coord, scope)
    await expect(service.createPlan(coord, scope)).rejects.toThrow(/Já existe/)

    // Professor sem atribuição não vê; atribuído vê e edita rascunho.
    await expect(service.getPlanDetail(prof, planId)).rejects.toThrow(/Sem acesso/)
    await service.setAssignment(coord, planId, prof.id, 'responsavel')
    expect((await service.listPlans(prof, {})).map((plan) => plan.id)).toEqual([planId])
    expect(await service.listPlans(other, {})).toEqual([])

    await expect(service.saveDraft(prof, versionId, [{ title: 'Frações', skills: [{ code: 'XX' }] }])).rejects.toMatchObject({ status: 422 })
    await expect(service.transitionVersion(prof, versionId, 'em_revisao')).rejects.toThrow(/ao menos uma unidade/)
    const saved = await service.saveDraft(prof, versionId, [{ title: 'Frações', content: 'Equivalência', objectives: 'Comparar frações', skills: [{ code: 'ef05ma03' }, { code: 'EF05MA04', description: 'Texto da escola', targetMasteryPercent: 80 }] }])
    expect(saved).toEqual({ unitCount: 1, skillCount: 2 })
    const draft = await service.getPlanDetail(prof, planId)
    expect(draft.units[0].skills).toEqual([
      { code: 'EF05MA03', description: 'Oficial EF05MA03', targetMasteryPercent: 100 },
      { code: 'EF05MA04', description: 'Texto da escola', targetMasteryPercent: 80 },
    ])
    expect(draft.permissions).toMatchObject({ edit: true, manage: false, transitions: ['em_revisao'] })

    // Revisão: professor não aprova; devolução exige justificativa.
    await service.transitionVersion(prof, versionId, 'em_revisao')
    await expect(service.saveDraft(prof, versionId, [{ title: 'X', skills: [] }])).rejects.toMatchObject({ status: 403 })
    await expect(service.transitionVersion(prof, versionId, 'aprovado')).rejects.toMatchObject({ status: 403 })
    await expect(service.transitionVersion(coord, versionId, 'rascunho')).rejects.toThrow(/Explique/)
    await service.transitionVersion(coord, versionId, 'rascunho', 'Incluir EF05MA05')
    await service.saveDraft(prof, versionId, [{ title: 'Frações', skills: [{ code: 'EF05MA03' }, { code: 'EF05MA04' }, { code: 'EF05MA05' }] }])
    await service.transitionVersion(prof, versionId, 'em_revisao')
    await service.transitionVersion(coord, versionId, 'aprovado', 'OK')

    // Aprovado não se edita: alteração vira nova versão com o conteúdo oficial.
    await expect(service.saveDraft(prof, versionId, [{ title: 'Y', skills: [] }])).rejects.toThrow(/nova versão/)
    const v2 = await service.startNewVersion(prof, planId, 'Trocar ordem')
    expect(v2.versionNumber).toBe(2)
    await expect(service.startNewVersion(prof, planId)).rejects.toThrow(/Já existe uma versão/)
    const v2Detail = await service.getPlanDetail(prof, planId)
    expect(v2Detail.selectedVersionId).toBe(v2.versionId)
    expect(v2Detail.officialVersionId).toBe(versionId)
    expect(v2Detail.units[0].skills.map((skill) => skill.code)).toEqual(['EF05MA03', 'EF05MA04', 'EF05MA05'])
    await service.transitionVersion(prof, v2.versionId, 'em_revisao')
    await service.transitionVersion(coord, v2.versionId, 'aprovado')
    expect((await service.getPlanDetail(coord, planId)).officialVersionId).toBe(v2.versionId)

    // Encerramento do bimestre trava; professor não reabre; gestão só com justificativa.
    const closing = await service.closeBimester(coord, 2027, 1)
    expect(closing).toEqual({ closed: ['Matemática 5º ano'], pending: [] })
    await expect(service.startNewVersion(prof, planId)).rejects.toThrow(/encerrado/)
    await expect(service.startNewVersion(coord, planId)).rejects.toThrow(/justificativa/)
    const v3 = await service.startNewVersion(coord, planId, 'Código BNCC trocado na planilha')
    expect(v3.versionNumber).toBe(3)

    const history = (await service.getPlanDetail(coord, planId)).history
    expect(history.some((item) => item.note === 'Incluir EF05MA05' && item.toStatus === 'rascunho')).toBe(true)
    expect(history.some((item) => item.toStatus === 'encerrado')).toBe(true)

    // Exportação em planilha (CSV ; com BOM), uma linha por habilidade.
    const csv = await service.exportPlanCsv(coord, planId, v2.versionId)
    expect(csv.body.startsWith('﻿Ano letivo;Segmento')).toBe(true)
    expect(csv.body.trim().split('\r\n')).toHaveLength(4)
    expect(csv.filename).toBe('planejamento-2027-matematica-5ano-1bim-v2.csv')
  })

  it('copia o ano anterior só a partir de versões aprovadas, com responsáveis, sem sobrescrever', async () => {
    const approved = await service.createPlan(coord, { academicYear: 2026, segment: 'anos-finais', gradeYear: 7, subject: 'História', bimester: 2 })
    await service.saveDraft(coord, approved.versionId, [{ title: 'Grandes navegações', skills: [{ code: 'EF07HI02' }] }])
    await service.setAssignment(coord, approved.planId, other.id, 'responsavel')
    await service.transitionVersion(coord, approved.versionId, 'em_revisao')
    await service.transitionVersion(coord, approved.versionId, 'aprovado')
    const draftOnly = await service.createPlan(coord, { academicYear: 2026, segment: 'anos-finais', gradeYear: 7, subject: 'Geografia', bimester: 2 })
    expect(draftOnly.planId).toBeGreaterThan(0)

    await expect(service.copyYear(prof, 2026, 2027)).rejects.toThrow(/coordenação/)
    const first = await service.copyYear(coord, 2026, 2027, { segment: 'anos-finais' })
    expect(first.created).toEqual(['História 7º ano, 2º bim.'])
    expect(first.skipped).toEqual(['Geografia 7º ano, 2º bim.: sem versão aprovada em 2026'])
    const second = await service.copyYear(coord, 2026, 2027, { segment: 'anos-finais' })
    expect(second.created).toEqual([])

    const [copied] = await service.listPlans(other, { academicYear: 2027 })
    expect(copied).toMatchObject({ subject: 'História', open: { status: 'rascunho', versionNumber: 1 }, official: null })
    const detail = await service.getPlanDetail(other, copied.id)
    expect(detail.units[0]).toMatchObject({ title: 'Grandes navegações', skills: [{ code: 'EF07HI02' }] })
    expect(detail.versions[0]).toMatchObject({ source: 'copia', sourceReference: '2026 v1' })
  })
})
