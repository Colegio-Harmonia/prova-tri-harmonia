// Integração dos pré-requisitos curriculares contra Postgres real em memória
// (PGlite), aplicando a migration 0056 junto com as demais.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb, pgliteInstalled } from '@/test/pgliteDb'

const state: { db?: unknown } = {}
vi.mock('@/db/client', () => ({ get db() { return state.db } }))
vi.mock('./bnccDescriptions', () => ({ enrichBnccDescriptions: async <T,>(skills: T[]) => skills }))

describe.skipIf(!pgliteInstalled())('pré-requisitos curriculares (Postgres real)', () => {
  let pg: import('@electric-sql/pglite').PGlite
  let service: typeof import('./prerequisiteService')
  const coord = { id: 1, role: 'coordenacao' }
  const teacher = { id: 2, role: 'professor' }
  const why = 'Usa a comparação de frações para montar razões entre grandezas.'

  beforeAll(async () => {
    const created = await createTestDb()
    pg = created.pg
    await pg.exec(`insert into users (id, name, email, role) values (1, 'Coord', 'c@x', 'coordenacao'), (2, 'Prof', 'p@x', 'professor')`)
    state.db = created.db
    service = await import('./prerequisiteService')
    const planning = await import('./planningService')
    const plan = async (gradeYear: number, bimester: number, codes: string[]) => {
      const { versionId } = await planning.createPlan(coord as never, { academicYear: 2026, segment: 'anos-finais', gradeYear, subject: 'Matemática', bimester })
      await planning.saveDraft(coord as never, versionId, [{ title: `Unidade ${gradeYear}.${bimester}`, skills: codes.map((code) => ({ code })) }])
    }
    await plan(6, 1, ['EF06MA07'])
    await plan(7, 1, ['EF07MA08', 'EF15AR13'])
    await plan(7, 2, ['EF07MA10'])
    // Planejamento de 2027 (ano futuro) não pode entrar no catálogo de 2026.
    const { versionId } = await planning.createPlan(coord as never, { academicYear: 2027, segment: 'anos-finais', gradeYear: 7, subject: 'Matemática', bimester: 4 })
    await planning.saveDraft(coord as never, versionId, [{ title: 'Teste 2027', skills: [{ code: 'EF07MA01' }] }])
  }, 60_000)

  it('a migration cria a tabela com as travas de integridade', async () => {
    const table = await pg.query(`select to_regclass('curriculum_skill_prerequisites') as name`)
    expect(table.rows[0]).toEqual({ name: 'curriculum_skill_prerequisites' })
    await expect(pg.query(`insert into curriculum_skill_prerequisites (subject, prerequisite_code, prerequisite_segment, prerequisite_grade_year, skill_code, skill_segment, skill_grade_year, source, strength, rationale) values ('Matemática', 'X', 'anos-finais', 7, 'X', 'anos-finais', 7, 'ia', 'apoio', 'mesmo código')`)).rejects.toThrow()
  })

  it('professor não sugere nem revisa', async () => {
    await expect(service.suggestPrerequisites({ viewer: teacher, segment: 'anos-finais', gradeYear: 7, subject: 'Matemática', generate: async () => ({ habilidades: [] }) })).rejects.toMatchObject({ status: 403 })
  })

  it('grava só sugestão válida, não repete a série já mapeada e preserva rejeição', async () => {
    const generate = vi.fn(async (prompt: string) => ({ habilidades: [
      ...(prompt.includes('EF07MA08 (7º ano, 1º bim.; ') && prompt.includes('HABILIDADES-ALVO:\nEF07MA08') ? [{ codigo: 'EF07MA08', prerequisitos: [{ codigo: 'EF06MA07', forca: 'essencial', justificativa: why }] }] : []),
      ...(prompt.includes('HABILIDADES-ALVO:\nEF07MA10') ? [{ codigo: 'EF07MA10', prerequisitos: [{ codigo: 'EF07MA08', forca: 'importante', justificativa: why }, { codigo: 'EF05MA99', forca: 'apoio', justificativa: why }] }] : []),
    ] }))
    const first = await service.suggestPrerequisites({ viewer: coord, segment: 'anos-finais', gradeYear: 7, subject: 'Matemática', generate })
    expect(first).toMatchObject({ created: 2, discarded: 1, targets: 2, aiCalls: 2, academicYear: 2026, ignoredCodes: ['EF15AR13'] })
    expect(generate.mock.calls.map(([prompt]) => prompt).join('\n')).not.toMatch(/EF15AR13|EF07MA01/)

    const listed = await service.listPrerequisites({ subject: 'Matemática', gradeYear: 7, status: 'sugerida' })
    expect(listed.map((row) => `${row.prerequisiteCode}->${row.skillCode}:${row.strength}`)).toEqual(['EF06MA07->EF07MA08:essencial', 'EF07MA08->EF07MA10:importante'])
    expect(listed[0].rationale).toBe(`Base oficial BNCC: Mesma unidade temática: Números. ${why}`)

    const rejected = listed.find((row) => row.skillCode === 'EF07MA10')!
    await service.reviewPrerequisite({ viewer: coord, id: rejected.id, status: 'rejeitada', note: 'Não depende disso.' })
    const second = await service.suggestPrerequisites({ viewer: coord, segment: 'anos-finais', gradeYear: 7, subject: 'Matemática', generate })
    expect(second).toMatchObject({ created: 0, alreadyMapped: 2, aiCalls: 0 })
    const after = await service.listPrerequisites({ subject: 'Matemática' })
    expect(after.find((row) => row.id === rejected.id)).toMatchObject({ status: 'rejeitada', reviewNote: 'Não depende disso.', reviewerName: 'Coord' })
  })

  it('só aprovados chegam à teia, com o peso da força', async () => {
    const [suggested] = await service.listPrerequisites({ status: 'sugerida' })
    expect(await service.approvedPrerequisitesFor(['EF07MA08'])).toEqual([])
    await service.reviewPrerequisite({ viewer: coord, id: suggested.id, status: 'aprovada', strength: 'importante' })
    expect(await service.approvedPrerequisitesFor(['ef07ma08'])).toEqual([{ prerequisiteCode: 'EF06MA07', skillCode: 'EF07MA08', strength: 'importante', weight: 0.7 }])
  })

  it('cadastro manual valida os códigos no planejamento e a ordem das séries', async () => {
    await expect(service.createManualPrerequisite({ viewer: coord, subject: 'Matemática', prerequisiteCode: 'EF07MA10', skillCode: 'EF06MA07', strength: 'apoio', rationale: why })).rejects.toMatchObject({ status: 400 })
    await expect(service.createManualPrerequisite({ viewer: coord, subject: 'Matemática', prerequisiteCode: 'EF09MA01', skillCode: 'EF07MA10', strength: 'apoio', rationale: why })).rejects.toMatchObject({ status: 400 })
    // O par que a coordenação rejeitou antes vira aprovado pelo cadastro direto.
    const row = await service.createManualPrerequisite({ viewer: coord, subject: 'Matemática', prerequisiteCode: 'ef07ma08', skillCode: 'EF07MA10', strength: 'essencial', rationale: why })
    expect(row).toMatchObject({ status: 'aprovada', strength: 'essencial', prerequisiteCode: 'EF07MA08' })
    expect(await service.approvedPrerequisitesFor(['EF07MA10'])).toHaveLength(1)
  })

  it('opções vêm dos planejamentos existentes', async () => {
    expect(await service.listPlanningOptions(2026)).toEqual([
      { segment: 'anos-finais', gradeYear: 6, subject: 'Matemática' },
      { segment: 'anos-finais', gradeYear: 7, subject: 'Matemática' },
    ])
  })
})
