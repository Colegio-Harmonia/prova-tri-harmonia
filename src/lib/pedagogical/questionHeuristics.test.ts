import { describe, expect, it } from 'vitest'

import { getPedagogicalConfidenceBand } from '@/config/pedagogicalConfidence'

import {
  compactPedagogicalEvidence,
  inferDokAndSoloExpected,
  normalizePedagogicalText,
} from './questionHeuristics'

describe('heuristicas pedagogicas de questoes', () => {
  it('normaliza texto e limita a evidencia enviada para revisao', () => {
    expect(normalizePedagogicalText('Geografia: Relação entre Países')).toBe(
      'geografia: relacao entre paises',
    )
    expect(compactPedagogicalEvidence('  linha  um\n\nlinha   dois  ')).toBe('linha um linha dois')
    expect(compactPedagogicalEvidence('a'.repeat(400))).toHaveLength(360)
  })

  it('propoe DOK 3 e SOLO relacional para resposta discursiva com justificativa', () => {
    const result = inferDokAndSoloExpected({
      text: 'Justifique qual estrategia territorial e mais adequada para reduzir a desigualdade.',
      questionType: 'descritiva',
      gradingCriteria: 'Relaciona causa, evidencia e proposta.',
    })

    expect(result.dok).toMatchObject({ categoryCode: 'DOK_3', confidence: 0.72 })
    expect(result.soloExpected).toMatchObject({ categoryCode: 'RELACIONAL', confidence: 0.72 })
    expect(result.confidenceBands).toEqual({
      dok: 'review_required',
      soloExpected: 'review_required',
    })
  })

  it('propoe DOK 2 para aplicacao de dados e SOLO multiestrutural', () => {
    const result = inferDokAndSoloExpected({
      text: 'Analise a tabela e determine a variacao percentual entre os dois anos.',
      bloomLevel: 'analisar',
      questionType: 'objetiva',
    })

    expect(result.dok).toMatchObject({ categoryCode: 'DOK_2', confidence: 0.78 })
    expect(result.soloExpected).toMatchObject({ categoryCode: 'MULTIESTRUTURAL', confidence: 0.74 })
    expect(result.confidenceBands).toEqual({
      dok: 'review_optional',
      soloExpected: 'review_required',
    })
  })

  it('preserva a classificacao conservadora para recuperacao direta', () => {
    const result = inferDokAndSoloExpected({
      text: 'Identifique a capital do Brasil.',
      questionType: 'objetiva',
    })

    expect(result.dok).toMatchObject({ categoryCode: 'DOK_1', confidence: 0.68 })
    expect(result.soloExpected).toMatchObject({ categoryCode: 'UNIESTRUTURAL', confidence: 0.68 })
    expect(result.confidenceBands).toEqual({
      dok: 'review_required',
      soloExpected: 'review_required',
    })
  })

  it('mantem os limites de confianca deterministas', () => {
    expect(getPedagogicalConfidenceBand(null)).toBe('unscored')
    expect(getPedagogicalConfidenceBand(0.9)).toBe('auto_eligible')
    expect(getPedagogicalConfidenceBand(0.75)).toBe('review_optional')
    expect(getPedagogicalConfidenceBand(0.6)).toBe('review_required')
    expect(getPedagogicalConfidenceBand(0.59)).toBe('below_threshold')
  })
})
