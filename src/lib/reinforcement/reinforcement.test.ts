import { describe, expect, it } from 'vitest'
import { distributeAcrossSkills, type ReinforcementCandidate } from './selectQuestions'

function candidate(id: number, skillCode: string, bloomLevel: string | null = null): ReinforcementCandidate {
  return { id, year: 2020 + (id % 5), skillCode, skillDescription: `desc ${skillCode}`, bloomLevel }
}

function pool(skillCode: string, count: number, blooms: (string | null)[] = [null]): ReinforcementCandidate[] {
  return Array.from({ length: count }, (_, i) => candidate(i + 1 + skillCode.charCodeAt(1) * 100, skillCode, blooms[i % blooms.length]))
}

describe('distributeAcrossSkills', () => {
  it('reparte igualmente entre habilidades com banco suficiente', () => {
    const bySkill = new Map([
      ['H5', pool('H5', 20)],
      ['H18', pool('H18', 20)],
      ['H22', pool('H22', 20)],
    ])
    const result = distributeAcrossSkills(bySkill, 15)
    expect(result.selected).toHaveLength(15)
    expect(result.perSkill).toEqual({ H5: 5, H18: 5, H22: 5 })
    expect(result.warnings).toEqual([])
  })

  it('redistribui a sobra quando uma habilidade tem poucas questões, com aviso', () => {
    const bySkill = new Map([
      ['H5', pool('H5', 2)],
      ['H18', pool('H18', 20)],
    ])
    const result = distributeAcrossSkills(bySkill, 10)
    expect(result.selected).toHaveLength(10)
    expect(result.perSkill.H5).toBe(2)
    expect(result.perSkill.H18).toBe(8)
    expect(result.warnings.some((w) => w.startsWith('H5:'))).toBe(true)
  })

  it('habilidade sem nenhuma questão elegível gera aviso próprio e fica de fora', () => {
    const bySkill = new Map([
      ['H1', []],
      ['H2', pool('H2', 10)],
    ])
    const result = distributeAcrossSkills(bySkill, 6)
    expect(result.perSkill.H1).toBe(0)
    expect(result.selected.every((c) => c.skillCode === 'H2')).toBe(true)
    expect(result.warnings.some((w) => w.includes('H1') && w.includes('nenhuma questão elegível'))).toBe(true)
  })

  it('banco insuficiente devolve menos questões com aviso — nunca inventa', () => {
    const bySkill = new Map([['H7', pool('H7', 4)]])
    const result = distributeAcrossSkills(bySkill, 10)
    expect(result.selected).toHaveLength(4)
    expect(result.warnings.some((w) => w.includes('só cobre 4 de 10'))).toBe(true)
  })

  it('varia os níveis de Bloom dentro da mesma habilidade quando há opção', () => {
    const bySkill = new Map([
      ['H9', pool('H9', 12, ['lembrar', 'aplicar', 'analisar'])],
    ])
    const result = distributeAcrossSkills(bySkill, 3)
    const blooms = new Set(result.selected.map((c) => c.bloomLevel))
    expect(blooms.size).toBe(3)
  })

  it('nunca seleciona a mesma questão duas vezes', () => {
    const bySkill = new Map([
      ['H3', pool('H3', 8)],
      ['H4', pool('H4', 8)],
    ])
    const result = distributeAcrossSkills(bySkill, 16)
    const ids = result.selected.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('não fixa a fila em um único ano quando há candidatos de anos diferentes', () => {
    const candidates = new Map([[
      'H3',
      [
        { ...candidate(1, 'H3'), year: 2025 },
        { ...candidate(2, 'H3'), year: 2024 },
        { ...candidate(3, 'H3'), year: 2015 },
      ],
    ]])
    const result = distributeAcrossSkills(candidates, 3)
    expect(new Set(result.selected.map((item) => item.year))).toEqual(new Set([2025, 2024, 2015]))
  })
})
