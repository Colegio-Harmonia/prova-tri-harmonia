import { describe, expect, it, vi } from 'vitest'
import { activityGenerationStrategyInstruction, decideActivityGenerationStrategy, routeActivityGenerationDecision, strategyFromActivityJevAnswers } from './activityGenerationDecision'
import type { evaluateWithJev } from './jevClient'

const input = {
  segment: 'anos-finais' as const,
  gradeYear: 7,
  subject: 'Matemática',
  pedagogicalIntent: 'recuperacao' as const,
  questionCount: 5,
  selectedSkills: [{ code: 'EF07MA01', description: 'Resolver problemas com números inteiros.', plannedQuestions: 5 }],
  units: [{ title: 'Números inteiros', objectives: ['Resolver problemas'], bnccCodes: ['EF07MA01'] }],
}

describe('activityGenerationDecision', () => {
  it('normaliza escolhas inválidas para a estratégia conservadora', () => {
    expect(strategyFromActivityJevAnswers({ approach: { type: 'choice', choice: 'inventada' } })).toEqual({
      approach: 'retomada_guiada', progression: 'gradual', support: 'pistas_graduais', evidence: 'verificacao_direta',
    })
  })

  it('exige probabilidade mínima para aplicação automática', () => {
    expect(routeActivityGenerationDecision({ ready: { type: 'noul', noul: 0.69 } }).route).toBe('review')
    expect(routeActivityGenerationDecision({ ready: { type: 'noul', noul: 0.7 } }).route).toBe('automatic')
  })

  it('mapeia a decisão tipada e preserva habilidade e matriz na instrução', async () => {
    const evaluate = vi.fn(async (options: Parameters<typeof evaluateWithJev>[0]) => ({
      model: 'jev', source: 'provider' as const, stateHash: 'hash', cacheKey: 'key',
      answers: {
        approach: { type: 'choice' as const, choice: 'aplicacao_contextualizada' },
        progression: { type: 'choice' as const, choice: 'desafio_progressivo' },
        support: { type: 'choice' as const, choice: 'autonomia_assistida' },
        evidence: { type: 'choice' as const, choice: 'transferencia_proxima' },
        ready: { type: 'noul' as const, noul: 0.88 },
      },
      routing: { route: 'automatic' as const, outcome: 'activity_strategy_selected' },
    }))
    const result = await decideActivityGenerationStrategy(input, { evaluate })
    expect(result.needsReview).toBe(false)
    expect(result.strategy.approach).toBe('aplicacao_contextualizada')
    const instruction = activityGenerationStrategyInstruction(result.strategy, ['EF07MA01'])
    expect(instruction).toContain('EF07MA01')
    expect(instruction).toContain('quantidade de questões')
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ operation: 'jev/activities/recovery-strategy' }))
  })
})
