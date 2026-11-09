import { describe, expect, it } from 'vitest'
import type { CurricularUnit } from '@/types/exam'
import { parseEnemSkills } from '@/lib/sheets/enemSkillsParser'
import { buildSkillBlock } from '@/lib/generation/unifiedRunner'
import { pickTargetEnemSkill } from './targetSkills'

// "Leading is changing" — Inglês 1º ano EM, exatamente como veio do material.
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

function unit(enemRaw: string): CurricularUnit {
  return {
    rowIndex: 0, bimestre: '1', tituloCapitulo: 'Leading is changing', conteudo: null,
    habilidades: { status: 'nao_mapeado', skills: [] },
    objetivos: [], objetivosColumnMissing: true,
    enemSkills: parseEnemSkills(enemRaw, 'linguagens'),
  }
}

describe('pickTargetEnemSkill', () => {
  it('distribui pelo peso do planejamento, mais frequente primeiro', () => {
    const u = unit(LEADING_IS_CHANGING)
    const picks = Array.from({ length: 11 }, (_, i) => pickTargetEnemSkill({ unit: u, slotIndexInUnit: i })?.code)
    expect(picks.slice(0, 3)).toEqual(['C2:H5', 'C2:H5', 'C2:H7'])
    // Em 11 questões, reproduz exatamente o peso do material.
    const counts = picks.reduce<Record<string, number>>((acc, code) => ({ ...acc, [code!]: (acc[code!] ?? 0) + 1 }), {})
    expect(counts).toEqual({ 'C2:H5': 8, 'C2:H7': 1, 'C6:H18': 1, 'C7:H21': 1 })
  })

  it('substituição mantém a habilidade da questão original quando é do capítulo', () => {
    const u = unit(LEADING_IS_CHANGING)
    expect(pickTargetEnemSkill({ unit: u, slotIndexInUnit: 0, forcedCode: 'C7:H21' })?.code).toBe('C7:H21')
    expect(pickTargetEnemSkill({ unit: u, slotIndexInUnit: 0, forcedCode: 'C9:H30' })?.code).toBe('C2:H5')
  })

  it('capítulo sem planejamento ENEM não recebe habilidade inventada', () => {
    expect(pickTargetEnemSkill({ unit: unit(''), slotIndexInUnit: 0 })).toBeNull()
  })
})

describe('buildSkillBlock com habilidade ENEM', () => {
  const base = { questionNumber: 1, subject: 'Inglês', gradeYear: 1, segment: 'ensino-medio', curriculumContent: 'x', questionType: 'objetiva' as const }

  it('sem BNCC, o bloco traz só a habilidade ENEM com a descrição oficial', () => {
    const block = buildSkillBlock({ ...base, targetSkills: [], targetEnemSkill: { code: 'C2:H5', description: 'Associar vocábulos e expressões de um texto em Língua Estrangeira Moderna ao seu tema.' } })
    expect(block).toContain('HABILIDADE ENEM-ALVO')
    expect(block).toContain('C2:H5 — Associar vocábulos')
    expect(block).not.toContain('HABILIDADE BNCC-ALVO')
  })

  it('com BNCC e ENEM, os dois aparecem', () => {
    const block = buildSkillBlock({ ...base, targetSkills: [{ code: 'EM13LGG401', description: null }], targetEnemSkill: { code: 'C2:H7', description: null } })
    expect(block).toContain('HABILIDADE BNCC-ALVO')
    expect(block).toContain('HABILIDADE ENEM-ALVO')
  })

  it('sem nenhuma habilidade, nada muda', () => {
    expect(buildSkillBlock({ ...base, targetSkills: [] })).toBe('')
  })
})
