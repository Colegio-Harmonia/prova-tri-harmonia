import { describe, expect, it, vi } from 'vitest'

vi.mock('@/db/client', () => ({ db: {} }))

import { matchUnitIndex, mergeEnemCodes, mergeObjectives, planChanges } from './applySuggestions'

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
    expect(matchUnitIndex(units, 'Revisão')).toBe(-2)
  })
})

describe('mergeObjectives', () => {
  it('acrescenta frases novas, uma por linha e com ponto, preservando o que o professor escreveu', () => {
    const merged = mergeObjectives('Identificar o lide de uma notícia.', ['identificar o lide de uma notícia', 'Produzir uma notícia sobre a escola.', '  ', 'Produzir uma notícia sobre a escola'])
    expect(merged.added).toEqual(['Produzir uma notícia sobre a escola'])
    expect(merged.objectives).toBe('Identificar o lide de uma notícia.\nProduzir uma notícia sobre a escola.')
  })
  it('começa do zero quando a unidade não tem objetivo', () => {
    expect(mergeObjectives(null, ['Explicar a função do verbete'])).toEqual({ objectives: 'Explicar a função do verbete.', added: ['Explicar a função do verbete'] })
    expect(mergeObjectives(null, [])).toEqual({ objectives: null, added: [] })
  })
})

describe('planChanges', () => {
  const units = [{ id: 10, title: 'Arcos', enemSkills: 'C2:H7', objectives: null }, { id: 11, title: 'Matrizes', enemSkills: null, objectives: 'Aplicar matrizes.' }]
  it('altera só os campos que mudam em cada unidade', () => {
    const planned = planChanges(units, [
      { bimester: 1, title: 'Arcos', objectives: ['Comparar grau e radiano'] },
      { bimester: 1, title: 'Matrizes', codes: ['C5:H21'], objectives: ['Aplicar matrizes'] },
    ], 'matematica')
    expect(planned.changes).toEqual([
      { unitId: 10, objectives: 'Comparar grau e radiano.' },
      { unitId: 11, enemSkills: 'C5:H21' },
    ])
    expect(planned.applied).toEqual([
      { title: 'Arcos', codes: [], objectives: ['Comparar grau e radiano'] },
      { title: 'Matrizes', codes: ['C5:H21'], objectives: [] },
    ])
  })
  it('sem área do ENEM, ignora códigos e ainda aceita objetivos', () => {
    const planned = planChanges(units, [{ bimester: 1, title: 'Arcos', codes: ['C4:H15'], objectives: ['Explicar o radiano'] }], null)
    expect(planned.changes).toEqual([{ unitId: 10, objectives: 'Explicar o radiano.' }])
  })
})

describe('planChanges — unidade que ainda não existe', () => {
  const units = [{ id: 10, title: 'Arcos', enemSkills: null, objectives: null }, { id: 11, title: 'Revisão', enemSkills: null, objectives: null }, { id: 12, title: 'revisão', enemSkills: null, objectives: null }]
  it('cria a unidade com o que foi escolhido, juntando pedidos do mesmo título', () => {
    const planned = planChanges(units, [
      { bimester: 2, title: 'Vetores e transformações lineares', codes: ['C5:H19', 'C9:H99'], createIfMissing: { content: 'Vetores • Matrizes' } },
      { bimester: 2, title: 'vetores e  transformações lineares', objectives: ['Aplicar operações com vetores'], createIfMissing: { content: 'outro' } },
    ], 'matematica')
    expect(planned.inserts).toEqual([{ title: 'Vetores e transformações lineares', content: 'Vetores • Matrizes', enemSkills: 'C5:H19', objectives: 'Aplicar operações com vetores.' }])
    expect(planned.changes).toEqual([])
    expect(planned.applied).toEqual([
      { title: 'Vetores e transformações lineares', codes: ['C5:H19'], objectives: [], created: true },
      { title: 'Vetores e transformações lineares', codes: [], objectives: ['Aplicar operações com vetores'], created: true },
    ])
  })
  it('não cria sem autorização nem quando o título é ambíguo no planejamento', () => {
    expect(planChanges(units, [{ bimester: 2, title: 'Vetores', codes: ['C5:H19'] }], 'matematica')).toMatchObject({ inserts: [], notFound: ['Vetores'] })
    expect(planChanges(units, [{ bimester: 2, title: 'Revisão', codes: ['C5:H19'], createIfMissing: {} }], 'matematica')).toMatchObject({ inserts: [], notFound: ['Revisão'] })
  })
})
