import { describe, expect, it, vi } from 'vitest'
import { decideResultOrganization, describeResultOrganization, prioritizeResultSkills, routeResultOrganizationDecision, strategyFromResultOrganizationAnswers, type ResultOrganizationDecisionInput } from './resultOrganizationDecision'

const input: ResultOrganizationDecisionInput = {
  scope: 'student', evidence: 'sufficient', completeness: 'complete',
  skills: [
    { code: 'EF05LP02', description: 'B', status: 'dominio', confidence: 'alta' },
    { code: 'EF05LP01', description: 'A', status: 'intervencao', confidence: 'media' },
  ],
  cognitiveLevels: [], managementSignals: [],
}

describe('resultOrganizationDecision', () => {
  it('maps only allowed typed choices', () => {
    expect(strategyFromResultOrganizationAnswers({
      primary_lens: { type: 'choice', choice: 'skill_gap' }, priority_order: { type: 'choice', choice: 'urgent_gap_first' },
      action_frame: { type: 'choice', choice: 'reteach_then_reassess' },
    })).toEqual({ primaryLens: 'skill_gap', priorityOrder: 'urgent_gap_first', actionFrame: 'reteach_then_reassess' })
  })

  it('routes low confidence to review', () => {
    expect(routeResultOrganizationDecision({ ready: { type: 'noul', noul: 0.69 } }).route).toBe('review')
    expect(routeResultOrganizationDecision({ ready: { type: 'noul', noul: 0.7 } }).route).toBe('automatic')
  })

  it('orders urgent skill first without changing measurements', () => {
    expect(prioritizeResultSkills(input, { primaryLens: 'skill_gap', priorityOrder: 'urgent_gap_first', actionFrame: 'reteach_then_reassess' })).toEqual(['EF05LP01', 'EF05LP02'])
  })

  it('uses fixed Portuguese explanations', () => {
    expect(describeResultOrganization({ primaryLens: 'skill_gap', priorityOrder: 'balanced', actionFrame: 'reteach_then_reassess' }, input)).toEqual({
      heading: 'Comece pelas habilidades que pedem intervenção',
      interpretation: 'Leia as habilidades na ordem de urgência e considere também a confiança da amostra.',
      nextAction: 'Retome a habilidade prioritária e verifique novamente com itens equivalentes.',
    })
  })

  it('falls back safely when provider is unavailable', async () => {
    const evaluate = vi.fn(async (options) => ({
      model: 'test', answers: options.fallback.answers, source: 'fallback' as const,
      routing: options.fallback.routing, stateHash: 'state', cacheKey: 'cache',
    }))
    const result = await decideResultOrganization(input, { evaluate })
    expect(result.source).toBe('fallback')
    expect(result.strategy.primaryLens).toBe('coverage')
    const state = evaluate.mock.calls[0][0].state
    expect(JSON.stringify(state)).not.toMatch(/studentName|studentId|answer|grade|score/i)
  })
})
