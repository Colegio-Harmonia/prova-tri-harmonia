import { describe, expect, it } from 'vitest'
import { resolveColumnRoles } from '@/lib/sheets/headerResolver'
import { parseCurriculumRows } from '@/lib/sheets/rowParser'
import { composePlanUnitTitle } from './planUnitTitle'

describe('composePlanUnitTitle', () => {
  it('junta a unidade ao capítulo quando a planilha as traz separadas', () => {
    expect(composePlanUnitTitle({ tituloCapitulo: '1. A great inventor', unidade: '7. Necessity is the mother of invention' }, 'Unidade 1'))
      .toBe('7. Necessity is the mother of invention — 1. A great inventor')
  })

  it('mantém o título quando não há unidade, ela repete o capítulo ou o capítulo está vazio', () => {
    expect(composePlanUnitTitle({ tituloCapitulo: '10. Doenças infecciosas', unidade: null }, 'Unidade 2')).toBe('10. Doenças infecciosas')
    expect(composePlanUnitTitle({ tituloCapitulo: 'Unit 3', unidade: ' unit  3 ' }, 'x')).toBe('Unit 3')
    expect(composePlanUnitTitle({ tituloCapitulo: '', unidade: 'Unit 3' }, 'x')).toBe('Unit 3')
    expect(composePlanUnitTitle({ tituloCapitulo: '  ', unidade: undefined }, 'Unidade 4')).toBe('Unidade 4')
  })
})

describe('leitura da coluna Unidade', () => {
  const rows = [['20/05/2026', '4', '7. Necessity is the mother of invention', '1. A great inventor', '• Passive voice', 'EF09LI02']]

  it('guarda a unidade separada quando a aba tem coluna de bimestre (Inglês)', () => {
    const roles = resolveColumnRoles(['Data Início Programada', 'Bimestre', 'Unidade', 'Capítulos', 'Conteúdos', 'Habilidades'])
    const [unit] = parseCurriculumRows(rows, roles, 'anos-finais')
    expect(unit.tituloCapitulo).toBe('1. A great inventor')
    expect(unit.unidade).toBe('7. Necessity is the mother of invention')
    expect(unit.bimestre).toBe('4')
  })

  it('não trata como unidade quando ela é a própria divisão do período', () => {
    const roles = resolveColumnRoles(['Data Início Programada', 'Ano', 'Unidade', 'Capítulos', 'Conteúdos', 'Habilidades'])
    const [unit] = parseCurriculumRows(rows, roles, 'anos-finais')
    expect(unit.unidade).toBeNull()
    expect(unit.bimestre).toBe('7. Necessity is the mother of invention')
  })
})
