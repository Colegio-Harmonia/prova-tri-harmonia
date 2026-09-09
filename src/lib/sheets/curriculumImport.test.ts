import { describe, expect, it } from 'vitest'

import { resolveColumnRoles } from './headerResolver'
import { parseCurriculumRows } from './rowParser'

describe('importacao curricular', () => {
  it('resolve cabecalhos por sinonimo e sem depender de acento', () => {
    expect(resolveColumnRoles([
      'Capítulo',
      'Conteúdos foco',
      'Habilidades',
      'Bimestre',
    ])).toEqual({
      tituloCapituloIdx: 0,
      conteudoIdx: 1,
      habilidadesIdx: 2,
      objetivosIdx: null,
      bimestreIdx: 3,
      trimestreIdx: null,
      unidadeIdx: null,
    })
  })

  it('ignora linhas vazias e estima objetivo quando a coluna nao existe', () => {
    const roles = resolveColumnRoles([
      'Capítulo',
      'Conteúdos foco',
      'Habilidades',
      'Bimestre',
    ])
    const units = parseCurriculumRows([
      ['', '', '', '1'],
      ['Europa contemporanea', 'Regioes e paisagens', '(EF08GE03) Analisar processos territoriais.', '2'],
      ['Dados externos', 'Indicadores sociais', 'SAE +', '3'],
    ], roles, 'anos-finais')

    expect(units).toHaveLength(2)
    expect(units[0]).toMatchObject({
      rowIndex: 1,
      bimestre: '2',
      tituloCapitulo: 'Europa contemporanea',
      conteudo: 'Regioes e paisagens',
      objetivosColumnMissing: true,
      objetivos: [{
        text: 'Europa contemporanea — Regioes e paisagens',
        kind: 'cognitiva',
        bloomLevel: 'compreender',
        estimated: true,
      }],
    })
    expect(units[0]?.habilidades).toEqual({
      status: 'mapeado',
      skills: [{ code: 'EF08GE03', description: 'Analisar processos territoriais.' }],
    })
    expect(units[1]?.habilidades).toMatchObject({ status: 'nao_mapeado', skills: [] })
  })

  it('mantem objetivos explicitos e separa objetivo atitudinal', () => {
    const roles = resolveColumnRoles([
      'Titulo',
      'Conteudos',
      'Habilidades',
      'Unidade',
      'Objetivos',
    ])
    const [unit] = parseCurriculumRows([
      ['Cartografia', 'Leitura de mapas', 'EF08GE01 EF08GE03', 'Unidade 1', 'Analisar mapas. Valorizar as diferencas culturais.'],
    ], roles, 'anos-finais')

    expect(unit).toMatchObject({
      bimestre: 'Unidade 1',
      objetivosColumnMissing: false,
      objetivos: [
        { text: 'Analisar mapas', kind: 'cognitiva', bloomLevel: 'analisar', estimated: false },
        { text: 'Valorizar as diferencas culturais.', kind: 'atitudinal', bloomLevel: null, estimated: false },
      ],
    })
    expect(unit?.habilidades).toEqual({
      status: 'mapeado',
      skills: [
        { code: 'EF08GE01', description: null },
        { code: 'EF08GE03', description: null },
      ],
    })
  })
})
