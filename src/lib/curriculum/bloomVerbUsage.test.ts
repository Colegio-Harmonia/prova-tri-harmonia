import { describe, expect, it, vi } from 'vitest'

vi.mock('@/db/client', () => ({ db: {} }))

import { BLOOM_BASE_VERBS, BLOOM_VERB_TABLE } from '@/config/bloomVerbs'
import { BLOOM_GUIDE } from '@/config/bloomGuide'
import { countBloomVerbUsage, splitObjectiveSentences } from './bloomVerbUsage'

describe('countBloomVerbUsage', () => {
  const usage = countBloomVerbUsage(
    ['(EF05MA07) Resolver e elaborar problemas de adição', 'Analisar o texto, identificando o tema', 'Valorizar a cultura popular', 'Dimensionar circuitos'],
    splitObjectiveSentences('Identificar o lide de uma notícia. Calcular a área do círculo.\nO aluno deve explicar o conceito'),
  )
  const row = (verb: string) => usage.rows.find((item) => item.verb === verb)!

  it('conta a frase para o verbo que abre e define o nível', () => {
    expect(row('elaborar')).toMatchObject({ level: 'criar', skills: 1, base: true })
    expect(row('resolver')).toMatchObject({ level: 'aplicar', skills: 0, base: false })
    expect(row('analisar').skills).toBe(1)
    expect(row('identificar')).toMatchObject({ skills: 0, objectives: 1 })
    expect(row('calcular').objectives).toBe(1)
  })

  it('não conta atitude, verbo fora da tabela nem verbo que não abre a frase', () => {
    expect(row('explicar').objectives).toBe(0)
    expect(usage.rows.reduce((sum, item) => sum + item.skills + item.objectives, 0)).toBe(4)
    expect(usage).toMatchObject({ skillSentences: 4, objectiveSentences: 3 })
  })

  it('traz uma linha por verbo da tabela, com os 25 do manual marcados', () => {
    expect(usage.rows).toHaveLength(Object.values(BLOOM_VERB_TABLE).flat().length)
    expect(usage.rows.filter((item) => item.base)).toHaveLength(25)
    expect([...BLOOM_BASE_VERBS].every((verb) => Object.values(BLOOM_VERB_TABLE).flat().includes(verb))).toBe(true)
  })
})

describe('guia de Bloom', () => {
  it('os exemplos de objetivo começam por verbo do próprio nível', () => {
    for (const [level, guide] of Object.entries(BLOOM_GUIDE)) {
      const usage = countBloomVerbUsage([], [guide.objectiveExample])
      expect(usage.rows.find((item) => item.objectives === 1)?.level, guide.objectiveExample).toBe(level)
    }
  })
})
