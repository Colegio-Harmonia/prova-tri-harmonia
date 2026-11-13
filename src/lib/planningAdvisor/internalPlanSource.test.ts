import { describe, expect, it, vi } from 'vitest'

vi.mock('@/db/client', () => ({ db: {} }))

import { buildCurriculumFromPlan } from '@/lib/curriculum/planCurriculum'
import { analyzePlanning } from './analyzePlanning'
import { mergeBimesterSelections } from './internalPlanSource'

const scope = { segment: 'ensino-medio' as const, gradeYear: 1, subject: 'Inglês' }

function bimester(number: number, enemSkills: string | null) {
  return {
    bimester: number,
    selection: buildCurriculumFromPlan({ ...scope, bimester: number }, `Planejamento interno #${number}`, [
      { position: 0, title: `Unit ${number}A`, content: 'Reading strategies', objectives: null, enemSkills, skills: [] },
      { position: 1, title: `Unit ${number}B`, content: 'Cognates', objectives: null, enemSkills: null, skills: [] },
    ]),
  }
}

describe('mergeBimesterSelections', () => {
  it('junta os bimestres em ordem, sem colidir rowIndex, e mantém os avisos', () => {
    const merged = mergeBimesterSelections(scope, [bimester(2, 'C2:H6'), bimester(1, 'C2:H5 (Unesp-2022)\nC2:H5')], ['3º bimestre fora da análise: sem versão aprovada'])
    expect(merged.units.map((unit) => [unit.rowIndex, unit.bimestre, unit.tituloCapitulo])).toEqual([
      [1000, '1', 'Unit 1A'], [1001, '1', 'Unit 1B'], [2000, '2', 'Unit 2A'], [2001, '2', 'Unit 2B'],
    ])
    expect(merged.tabName).toBe('Planejamento interno aprovado (1º bimestre, 2º bimestre)')
    expect(merged.unmappedWarnings.at(-1)).toContain('3º bimestre fora da análise')
  })

  it('alimenta a análise com as habilidades ENEM do planejamento interno', () => {
    const analysis = analyzePlanning(mergeBimesterSelections(scope, [bimester(1, 'C2:H5\nC2:H5'), bimester(2, 'C2:H6')]))
    expect(analysis.enem?.rows.map((row) => row.code)).toEqual(['C2:H5', 'C2:H6', 'C2:H7', 'C2:H8'])
    expect(analysis.enem?.coveredCount).toBe(2)
    expect(analysis.enem?.rows[0].occurrences).toBe(2)
    expect(analysis.enem?.chaptersWithoutEnem).toBe(2)
  })
})
