import { describe, expect, it } from 'vitest'
import { shouldRequireVisualAid, validateCurriculumPlan } from './contentPlan'
import type { CurriculumSelection } from '@/types/exam'

const units: CurriculumSelection['units'] = [
  { rowIndex: 4, bimestre: '2', tituloCapitulo: 'Semelhança de triângulos', conteudo: 'Geometria plana', habilidades: { status: 'nao_mapeado', skills: [] }, objetivos: [], objetivosColumnMissing: false },
  { rowIndex: 5, bimestre: '2', tituloCapitulo: 'Estatística', conteudo: 'Leitura de dados', habilidades: { status: 'nao_mapeado', skills: [] }, objetivos: [], objetivosColumnMissing: false },
]

describe('contentPlan', () => {
  it('mantém apenas os capítulos selecionados e exige a soma definida', () => {
    const result = validateCurriculumPlan(units, [
      { unitRowIndex: 4, questionCount: 3, priority: 'alta', visualAid: 'auto' },
      { unitRowIndex: 5, questionCount: 0, priority: 'baixa', visualAid: 'sem_imagem' },
    ], 3)
    expect(result.selectedUnits.map((unit) => unit.rowIndex)).toEqual([4])
    expect(() => validateCurriculumPlan(units, [{ unitRowIndex: 4, questionCount: 2, priority: 'alta', visualAid: 'auto' }], 3)).toThrow('soma 2')
  })

  it('identifica conteúdos cuja interpretação visual é parte do item', () => {
    expect(shouldRequireVisualAid(units[0])).toBe(true)
    expect(shouldRequireVisualAid(units[1])).toBe(true)
  })
})
