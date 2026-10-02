import { describe, expect, it } from 'vitest'
import type { CurricularUnit } from '@/types/exam'
import { cognitiveObjectives, pickTargetSkills } from './targetSkills'

const unit = (skills: Array<{ code: string; description: string | null }>): CurricularUnit => ({
  rowIndex: 1, bimestre: '4', tituloCapitulo: 'Combustíveis', conteudo: null, objetivosColumnMissing: false,
  habilidades: skills.length ? { status: 'mapeado', skills } : { status: 'nao_mapeado', skills: [] },
  objetivos: [
    { text: 'Avaliar o uso de combustíveis.', kind: 'cognitiva', bloomLevel: 'avaliar', estimated: false },
    { text: 'Respeitar os colegas.', kind: 'atitudinal', bloomLevel: null, estimated: false },
  ],
})

describe('pickTargetSkills', () => {
  const skills = [{ code: 'EF07CI05', description: 'Discutir combustíveis.' }, { code: 'EF07CI06', description: null }]

  it('distribui as habilidades do capítulo em rodízio pela posição da questão', () => {
    const codes = [0, 1, 2, 3].map((index) => pickTargetSkills({ unit: unit(skills), slotIndexInUnit: index })[0]!.code)
    expect(codes).toEqual(['EF07CI05', 'EF07CI06', 'EF07CI05', 'EF07CI06'])
  })

  it('completa a descrição ausente com a descrição oficial resolvida', () => {
    const [skill] = pickTargetSkills({ unit: unit(skills), slotIndexInUnit: 1, descriptions: new Map([['EF07CI06', 'Discutir e avaliar mudanças.']]) })
    expect(skill).toEqual({ code: 'EF07CI06', description: 'Discutir e avaliar mudanças.' })
  })

  it('respeita o código forçado (atividade BNCC / substituição de questão)', () => {
    expect(pickTargetSkills({ unit: unit(skills), slotIndexInUnit: 0, forcedCodes: ['ef07ci06'] }).map((s) => s.code)).toEqual(['EF07CI06'])
  })

  it('não inventa habilidade quando o capítulo não tem BNCC mapeada', () => {
    expect(pickTargetSkills({ unit: unit([]), slotIndexInUnit: 0 })).toEqual([])
  })
})

describe('cognitiveObjectives', () => {
  it('ignora objetivos atitudinais', () => {
    expect(cognitiveObjectives(unit([]))).toEqual(['Avaliar o uso de combustíveis.'])
  })
})
