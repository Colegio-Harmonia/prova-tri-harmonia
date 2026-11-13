import { describe, expect, it, vi } from 'vitest'

vi.mock('@/db/client', () => ({ db: {} }))

import { buildCurriculumFromPlan } from '@/lib/curriculum/planCurriculum'
import { resolveColumnRoles } from '@/lib/sheets/headerResolver'
import { parseCurriculumRows } from '@/lib/sheets/rowParser'
import type { CurriculumSelection } from '@/types/exam'
import { analyzePlanning } from './analyzePlanning'
import { combineSources, unitOrigin, type BimesterSelection } from './internalPlanSource'
import { PLAN_ROW_OFFSET } from './rowOrigin'

const scope = { segment: 'ensino-medio' as const, gradeYear: 2, subject: 'Matemática' }

function plan(bimester: number, status: BimesterSelection['status'], units: Array<[string, string | null]>): BimesterSelection {
  return {
    bimester, versionNumber: 2, status,
    selection: buildCurriculumFromPlan({ ...scope, bimester }, `Planejamento interno #${bimester}`, units.map(([title, enemSkills], position) => ({ position, title, content: null, objectives: null, enemSkills, skills: [] }))),
  }
}

function sheet(): CurriculumSelection {
  const header = ['Bimestre', 'Capítulo', 'Conteúdos', 'Habilidades']
  const rows = [
    ['1', 'Arcos', 'Medidas de arcos', 'EM13MAT306'],
    ['4', 'Matrizes (planilha)', 'Operações', ''],
    ['2', 'Funções trigonométricas', 'Seno e cosseno', 'EM13MAT306'],
    ['', 'Revisão geral', 'Sem bimestre', ''],
  ]
  return { ...scope, tabName: 'Matematica Tamiris', units: parseCurriculumRows(rows, resolveColumnRoles(header), 'ensino-medio', 'Matemática'), unmappedWarnings: ['aviso da planilha'] }
}

describe('combineSources', () => {
  it('usa o Planejamento no bimestre que já tem e a planilha nos demais', () => {
    const combined = combineSources(scope, [plan(4, 'rascunho', [['Matrizes', 'C5:H21'], ['Determinantes', null]])], sheet())
    expect(combined.units.map((unit) => [unit.bimestre, unit.tituloCapitulo, unitOrigin(unit)])).toEqual([
      ['1', 'Arcos', 'planilha'],
      ['2', 'Funções trigonométricas', 'planilha'],
      ['4', 'Matrizes', 'planejamento'],
      ['4', 'Determinantes', 'planejamento'],
      [null, 'Revisão geral', 'planilha'],
    ])
    expect(combined.units[2].rowIndex).toBe(4 * PLAN_ROW_OFFSET)
    expect(new Set(combined.units.map((unit) => unit.rowIndex)).size).toBe(5)
    expect(combined.tabName).toBe('Planejamento da Prova TRI (4º bim., versão 2 rascunho) + planilha "Matematica Tamiris" (1º, 2º bim.)')
    expect(combined.unmappedWarnings).toContain('aviso da planilha')
  })

  it('sem planilha, analisa só o que está no Planejamento e registra o aviso', () => {
    const combined = combineSources(scope, [plan(2, 'aprovado', [['B', null]]), plan(1, 'encerrado', [['A', 'C1:H1']])], null, ['planilha indisponível'])
    expect(combined.units.map((unit) => unit.tituloCapitulo)).toEqual(['A', 'B'])
    expect(combined.tabName).toBe('Planejamento da Prova TRI (1º bim., versão 2 encerrado; 2º bim., versão 2 aprovado)')
    expect(combined.unmappedWarnings).toEqual(expect.arrayContaining(['planilha indisponível']))
  })

  it('sem planejamento, devolve a planilha como está', () => {
    const combined = combineSources(scope, [], sheet())
    expect(combined.units).toHaveLength(4)
    expect(combined.units.every((unit) => unitOrigin(unit) === 'planilha')).toBe(true)
    expect(combined.tabName).toBe('planilha "Matematica Tamiris" (1º, 2º, 4º bim.)')
  })

  it('a análise enxerga as habilidades ENEM do rascunho e marca a origem do capítulo', () => {
    const analysis = analyzePlanning(combineSources(scope, [plan(4, 'rascunho', [['Matrizes', 'C5:H21'], ['Determinantes', null]])], sheet()))
    const matrizes = analysis.chapters.find((chapter) => chapter.title === 'Matrizes')!
    expect(matrizes).toMatchObject({ origin: 'planejamento', bimesterNumber: 4, planTitle: 'Matrizes' })
    expect(matrizes.enemSkills.map((skill) => skill.code)).toEqual(['C5:H21'])
    expect(analysis.chapters.find((chapter) => chapter.title === 'Arcos')?.origin).toBe('planilha')
    expect(analysis.enem?.coveredCount).toBe(1)
  })
})
