import { describe, expect, it } from 'vitest'
import { buildActivityBnccSlots, validateActivityBnccPlan } from './activityBnccPlan'

const curriculum = {
  segment: 'anos-finais' as const,
  gradeYear: 6,
  subject: 'Ciências',
  bimester: 1,
  tabName: 'Ciências',
  unmappedWarnings: [],
  units: [
    { rowIndex: 1, bimestre: '1', tituloCapitulo: 'Vida', conteudo: 'Células', habilidades: { status: 'mapeado' as const, skills: [{ code: 'EF06CI05', description: 'Reconhecer células.' }] }, objetivos: [], objetivosColumnMissing: false },
    { rowIndex: 2, bimestre: '1', tituloCapitulo: 'Matéria', conteudo: 'Misturas', habilidades: { status: 'mapeado' as const, skills: [{ code: 'EF06CI06', description: 'Classificar misturas.' }] }, objetivos: [], objetivosColumnMissing: false },
  ],
}

describe('activity BNCC plan', () => {
  it('expande as quantidades planejadas em posições de geração por habilidade', () => {
    expect(buildActivityBnccSlots(curriculum, [{ code: 'ef06ci05', questionCount: 2 }, { code: 'EF06CI06', questionCount: 1 }], 3).map((slot) => slot.code)).toEqual(['EF06CI05', 'EF06CI05', 'EF06CI06'])
  })

  it('rejeita matriz cuja soma difere da quantidade da atividade', () => {
    expect(() => validateActivityBnccPlan([{ code: 'EF06CI05', questionCount: 2 }], 3)).toThrow('soma 2 questão')
  })
})
