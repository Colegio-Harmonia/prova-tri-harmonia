import { describe, expect, it } from 'vitest'
import { extractEnemCode, parseEnemSkills } from './enemSkillsParser'

const LEADING_IS_CHANGING = `C2:H7 (IFSULDEMINAS-2022)
C6:H18 (IFSULDEMINAS-2022)
C2:H5 (UFT-2019)
C2:H5 (UFT-2019)
C2:H5 (UFT-2019)
C7:H21 (Unicentro-2017)
C2:H5 (Unicentro-2017)
C2:H5 (Unicentro-2017)
C2:H5 (PUC-Rio-2019)
C2:H5 (PUC-Rio-2019)
C2:H5 (PUC-Rio-2019)`

describe('parseEnemSkills', () => {
  it('agrega repetições como peso e guarda a origem das questões', () => {
    const result = parseEnemSkills(LEADING_IS_CHANGING, 'linguagens')
    expect(result.invalid).toEqual([])
    expect(result.skills.map((s) => [s.code, s.count])).toEqual([
      ['C2:H5', 8],
      ['C2:H7', 1],
      ['C6:H18', 1],
      ['C7:H21', 1],
    ])
    expect(result.skills[0]?.sources).toEqual(['UFT-2019', 'Unicentro-2017', 'PUC-Rio-2019'])
    expect(result.skills[0]?.description).toMatch(/Língua Estrangeira Moderna ao seu tema/)
  })

  it('aceita variações de escrita e linha sem origem', () => {
    const result = parseEnemSkills('c2-h6 C4 H14 (Enem-2020) C9:H30', 'linguagens')
    expect(result.skills.map((s) => s.code).sort()).toEqual(['C2:H6', 'C4:H14', 'C9:H30'])
    expect(result.skills.find((s) => s.code === 'C4:H14')?.sources).toEqual(['Enem-2020'])
  })

  it('separa pares inexistentes na matriz da área sem corrigir por palpite', () => {
    const result = parseEnemSkills('C2:H5 C2:H14 C1:H5', 'linguagens')
    expect(result.skills.map((s) => s.code)).toEqual(['C2:H5'])
    expect(result.invalid).toEqual(['C2:H14', 'C1:H5'])
  })

  it('valida pela fronteira da área certa (Matemática C1 vai até H5)', () => {
    expect(parseEnemSkills('C1:H5', 'matematica').invalid).toEqual([])
    expect(parseEnemSkills('C1:H5', 'matematica').skills[0]?.description).toBeNull()
  })

  it('não confunde código BNCC com código ENEM', () => {
    expect(parseEnemSkills('EM13LGG401 EM13LP01', 'linguagens')).toEqual({ skills: [], invalid: [] })
    expect(parseEnemSkills('', 'linguagens')).toEqual({ skills: [], invalid: [] })
  })
})

describe('extractEnemCode', () => {
  it('lê o código no formato canônico e no antigo "C2-H7"', () => {
    expect(extractEnemCode('C2:H5 — Associar vocábulos')).toEqual({ code: 'C2:H5', competency: 2, skill: 5 })
    expect(extractEnemCode('C2-H7')).toEqual({ code: 'C2:H7', competency: 2, skill: 7 })
    expect(extractEnemCode('H5 — Associar')).toBeNull()
  })
})
