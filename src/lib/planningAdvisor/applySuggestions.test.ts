import { describe, expect, it, vi } from 'vitest'

vi.mock('@/db/client', () => ({ db: {} }))

import { matchUnitIndex, mergeEnemCodes } from './applySuggestions'

describe('mergeEnemCodes', () => {
  it('acrescenta só códigos novos e válidos, preservando pesos e origens', () => {
    const merged = mergeEnemCodes('C2:H5 (Unesp-2022)\nC2:H5 (UFT-2019)', ['C2:H5', 'c2-h6', 'C9:H40', 'EM13LGG101', 'C2:H6'], 'linguagens')
    expect(merged.added).toEqual(['C2:H6'])
    expect(merged.enemSkills).toBe('C2:H5 (Unesp-2022)\nC2:H5 (UFT-2019)\nC2:H6')
  })

  it('recusa par competência:habilidade que não existe na área', () => {
    expect(mergeEnemCodes(null, ['C2:H21'], 'ciencias-natureza')).toEqual({ enemSkills: null, added: [] })
    expect(mergeEnemCodes('', ['C6:H21'], 'ciencias-natureza')).toEqual({ enemSkills: 'C6:H21', added: ['C6:H21'] })
  })
})

describe('matchUnitIndex', () => {
  const units = [{ title: 'Arcos' }, { title: 'Trigonometria  na circunferência ' }, { title: 'Revisão' }, { title: 'revisão' }]
  it('casa pelo título, ignorando caixa e espaços', () => {
    expect(matchUnitIndex(units, 'arcos')).toBe(0)
    expect(matchUnitIndex(units, 'Trigonometria na circunferência')).toBe(1)
  })
  it('não escolhe quando o título não existe ou é ambíguo', () => {
    expect(matchUnitIndex(units, 'Logaritmos')).toBe(-1)
    expect(matchUnitIndex(units, 'Revisão')).toBe(-1)
  })
})
