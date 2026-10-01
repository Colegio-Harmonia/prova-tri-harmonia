import { describe, expect, it, vi } from 'vitest'
import { evaluateWithJev, parseJevAnswers, type JevDecisionResult, type JevQuestions } from './jevClient'
import type { JevDecisionStore, StoredJevDecision } from './jevDecisionStore'
import { AI_BUDGET_EXHAUSTED_CODE, AiBudgetExceededError } from './operationBudget'

const questions: JevQuestions = {
  aligned: { type: 'noul', instructions: 'O texto está alinhado?', criteria: { true: 'sim', false: 'não' } },
}

function fakeStore(): JevDecisionStore & { rows: StoredJevDecision[] } {
  const rows: StoredJevDecision[] = []
  return {
    rows,
    async findCached(cacheKey, now) {
      const row = [...rows].reverse().find((item) => item.cacheKey === cacheKey && item.status === 'succeeded' && item.cacheExpiresAt && item.cacheExpiresAt > now)
      return row?.answers ? { model: row.model, answers: row.answers, cacheExpiresAt: row.cacheExpiresAt } : null
    },
    async record(decision) { rows.push(decision) },
  }
}

const route = (answers: ReturnType<typeof parseJevAnswers>) => ({
  route: (answers.aligned.type === 'noul' && (answers.aligned.noul >= 0.8 || answers.aligned.noul <= 0.2) ? 'automatic' : 'review') as 'automatic' | 'review',
  outcome: 'alignment_checked',
})

const fallback = { answers: {}, routing: { route: 'fallback', outcome: 'manual_review_required' } } as const

describe('evaluateWithJev', () => {
  it('devolve resposta tipada, registra auditoria e telemetria', async () => {
    const store = fakeStore()
    const telemetry = vi.fn(async () => undefined)
    const result = await evaluateWithJev({
      operation: 'jev/test', questionVersion: 'v1', state: { text: 'exemplo' }, questions, route, fallback,
      apiKey: 'key', store, telemetry, reserveOperation: null, fetchImpl: vi.fn(async () => new Response(JSON.stringify({ model: 'jev-1.13.0', answers: { aligned: { type: 'noul', noul: 0.94 } } }))),
    })
    expect(result).toMatchObject({ source: 'provider', model: 'jev-1.13.0', routing: { route: 'automatic' } })
    expect(store.rows[0]).toMatchObject({ status: 'succeeded', source: 'provider', stateHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(store.rows[0].context).toBeNull()
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({ provider: 'typesafe', status: 'succeeded' }))
  })

  it('envia escolhas no contrato atual da API TypeSafe', async () => {
    const choiceQuestions: JevQuestions = {
      action: {
        type: 'choice',
        instructions: 'Qual ação deve ser aplicada?',
        criteria: { revisar: 'Revisar evidências.', intervir: 'Criar intervenção.' },
      },
    }
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        questions: {
          action: {
            type: 'choice',
            criteria: { revisar: 'Revisar evidências.', intervir: 'Criar intervenção.' },
          },
        },
      })
      expect(JSON.parse(String(init?.body)).questions.action).not.toHaveProperty('options')
      return new Response(JSON.stringify({ answers: { action: { type: 'choice', choice: 'revisar', probabilities: { revisar: 0.9, intervir: 0.1 }, confidence: 0.8 } } }))
    })

    const result = await evaluateWithJev({
      operation: 'jev/choice-contract', questionVersion: 'v1', state: {}, questions: choiceQuestions,
      route: () => ({ route: 'automatic', outcome: 'selected' }), fallback,
      apiKey: 'key', store: null, telemetry: null, reserveOperation: null, fetchImpl,
    })

    expect(result).toMatchObject({ source: 'provider', answers: { action: { choice: 'revisar' } } })
  })

  it('reutiliza cache sem nova chamada ao provedor', async () => {
    const store = fakeStore()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ answers: { aligned: { type: 'noul', noul: 0.91 } } })))
    const options = { operation: 'jev/cache-test', questionVersion: 'v1', state: { text: 'único' }, questions, route, fallback, apiKey: 'key', store, telemetry: null, reserveOperation: null, fetchImpl, cacheTtlMs: 60_000 }
    const first: JevDecisionResult = await evaluateWithJev(options)
    const second = await evaluateWithJev(options)
    expect(first.source).toBe('provider')
    expect(second.source).toBe('cache')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(store.rows.at(-1)?.source).toBe('cache')
  })

  it('cai para revisão manual sem chave ou com resposta inválida', async () => {
    const store = fakeStore()
    const withoutKey = await evaluateWithJev({ operation: 'jev/no-key', questionVersion: 'v1', state: {}, questions, route, fallback, apiKey: '', store, telemetry: null })
    expect(withoutKey).toMatchObject({ source: 'fallback', routing: { route: 'fallback' } })

    const invalid = await evaluateWithJev({ operation: 'jev/invalid', questionVersion: 'v1', state: {}, questions, route, fallback, apiKey: 'key', store, telemetry: null, reserveOperation: null, fetchImpl: vi.fn(async () => new Response(JSON.stringify({ answers: {} }))) })
    expect(invalid.source).toBe('fallback')
    expect(store.rows.at(-1)).toMatchObject({ status: 'failed', errorCode: 'invalid_provider_response' })
  })

  it('respeita o orçamento antes de chamar o provedor', async () => {
    const store = fakeStore()
    const fetchImpl = vi.fn()
    const telemetry = vi.fn(async () => undefined)
    const result = await evaluateWithJev({
      operation: 'jev/budget', questionVersion: 'v1', state: {}, questions, route, fallback,
      apiKey: 'key', store, telemetry, fetchImpl,
      reserveOperation: async () => { throw new AiBudgetExceededError(50, 'text_generation') },
    })
    expect(result.source).toBe('fallback')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(store.rows.at(-1)).toMatchObject({ status: 'failed', errorCode: AI_BUDGET_EXHAUSTED_CODE })
    expect(telemetry).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', errorCode: AI_BUDGET_EXHAUSTED_CODE }))
  })
})
