import { describe, expect, it, vi } from 'vitest'
import { decideReinforcementSelectionStrategy, reinforcementAllocationWeights, routeReinforcementSelectionDecision, strategyFromReinforcementJevAnswers } from './reinforcementSelectionDecision'
import type { evaluateWithJev } from './jevClient'

const skills = [
  { code: 'H1', description: 'Habilidade 1', candidateCount: 2, bloomLevels: ['aplicar'] },
  { code: 'H2', description: 'Habilidade 2', candidateCount: 10, bloomLevels: ['analisar'] },
  { code: 'H3', description: 'Habilidade 3', candidateCount: 30, bloomLevels: [] },
]

const input = { gradeYear: 3, subject: 'Matemática', area: 'MT', questionCount: 15, requestedYear: null, skills }

describe('reinforcementSelectionDecision', () => {
  it('normaliza respostas inválidas para estratégia conservadora', () => {
    expect(strategyFromReinforcementJevAnswers({ allocation: { type: 'choice', choice: 'inventada' } })).toEqual({
      allocation: 'equilibrada', bloomProfile: 'fundamentos_aplicacao', yearMix: 'amplo',
    })
  })

  it('exige 0,7 para aplicação automática', () => {
    expect(routeReinforcementSelectionDecision({ ready: { type: 'noul', noul: 0.69 } }).route).toBe('review')
    expect(routeReinforcementSelectionDecision({ ready: { type: 'noul', noul: 0.7 } }).route).toBe('automatic')
  })

  it('calcula pesos determinísticos somente pela oferta do banco', () => {
    expect(reinforcementAllocationWeights({ allocation: 'cobertura_habilidades', bloomProfile: 'aplicacao_contextual', yearMix: 'amplo' }, skills)).toEqual({ H1: 3, H2: 3, H3: 1 })
    expect(reinforcementAllocationWeights({ allocation: 'profundidade_banco', bloomProfile: 'aplicacao_contextual', yearMix: 'amplo' }, skills)).toEqual({ H1: 1, H2: 1, H3: 2 })
  })

  it('mapeia decisão tipada do provedor', async () => {
    const evaluate = vi.fn(async (_options: Parameters<typeof evaluateWithJev>[0]) => ({
      model: 'jev', source: 'provider' as const, stateHash: 'hash', cacheKey: 'key',
      answers: {
        allocation: { type: 'choice' as const, choice: 'profundidade_banco' },
        bloom_profile: { type: 'choice' as const, choice: 'aplicacao_contextual' },
        year_mix: { type: 'choice' as const, choice: 'recente_variado' },
        ready: { type: 'noul' as const, noul: 0.9 },
      },
      routing: { route: 'automatic' as const, outcome: 'reinforcement_strategy_selected' },
    }))
    const result = await decideReinforcementSelectionStrategy(input, { evaluate })
    expect(result.needsReview).toBe(false)
    expect(result.strategy.allocation).toBe('profundidade_banco')
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ operation: 'jev/reinforcement/enem-selection' }))
  })
})
