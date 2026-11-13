import { describe, expect, it, vi } from 'vitest'
import { describeJevFailure, evaluateWithJev, JevUnavailableError, parseJevAnswers, validateJevQuestionContract, type JevDecisionResult, type JevQuestions } from './jevClient'
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

  it('envia critérios score como rubrica ordenada e rejeita objetos antes da chamada', async () => {
    const scoreQuestions: JevQuestions = {
      adequacao: { type: 'score', instructions: 'Avalie de 0 a 9.', criteria: Array.from({ length: 10 }, (_, index) => `Nível ${index}`) },
    }
    expect(validateJevQuestionContract(scoreQuestions)).toBeNull()

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).questions.adequacao.criteria).toEqual(Array.from({ length: 10 }, (_, index) => `Nível ${index}`))
      return new Response(JSON.stringify({ answers: { adequacao: { type: 'score', score: 7 } } }))
    })
    const validResult = await evaluateWithJev({
      operation: 'jev/score-contract', questionVersion: 'v1', state: {}, questions: scoreQuestions,
      route: () => ({ route: 'automatic', outcome: 'scored' }), fallback,
      apiKey: 'key', store: null, telemetry: null, reserveOperation: null, fetchImpl,
    })
    expect(validResult).toMatchObject({ source: 'provider', answers: { adequacao: { score: 7 } } })

    const invalidQuestions = {
      adequacao: { type: 'score', instructions: 'Avalie de 0 a 10.', criteria: { scale: '0-10' } },
    } as unknown as JevQuestions
    expect(validateJevQuestionContract(invalidQuestions)).toBe('invalid_score_criteria:adequacao')
    const invalidFetch = vi.fn()
    const invalidStore = fakeStore()
    const invalidResult = await evaluateWithJev({
      operation: 'jev/invalid-score-contract', questionVersion: 'v1', state: {}, questions: invalidQuestions,
      route: () => ({ route: 'review', outcome: 'invalid' }), fallback,
      apiKey: 'key', store: invalidStore, telemetry: null, reserveOperation: null, fetchImpl: invalidFetch,
    })
    expect(invalidResult).toMatchObject({ source: 'fallback', failure: { category: 'invalid_request', providerErrorCode: 'invalid_score_criteria' } })
    expect(invalidFetch).not.toHaveBeenCalled()
    expect(invalidStore.rows.at(-1)?.context).toMatchObject({ invalidQuestionId: 'adequacao' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const overLimitQuestions: JevQuestions = {
      adequacao: { type: 'score', instructions: 'Avalie.', criteria: Array.from({ length: 11 }, (_, index) => `Nível ${index}`) },
    }
    expect(validateJevQuestionContract(overLimitQuestions)).toBe('invalid_score_criteria:adequacao')
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

  it('identifica rejeição de pagamento HTTP 402 sem tratá-la como falha transitória', async () => {
    const result = await evaluateWithJev({
      operation: 'jev/http-402', questionVersion: 'v1', state: {}, questions, route, fallback,
      apiKey: 'key', store: fakeStore(), telemetry: null, reserveOperation: null,
      fetchImpl: vi.fn(async () => new Response('{}', { status: 402 })),
    })
    expect(result.failure).toMatchObject({ category: 'provider_payment_required', httpStatus: 402 })
    expect(new JevUnavailableError(result.failure!, 'falha').retryable).toBe(false)
  })

  it('preserva status, request id e limites em rejeições HTTP sem guardar o corpo bruto', async () => {
    const store = fakeStore()
    const result = await evaluateWithJev({
      operation: 'jev/http-422', questionVersion: 'v1', state: { text: 'não persistir' }, questions, route, fallback,
      apiKey: 'key', store, telemetry: null, reserveOperation: null,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        error: { message: 'texto que não deve ser armazenado', code: 'invalid_question' },
        detail: [{ loc: ['body', 'questions', 'bncc_alignment', 'criteria'], type: 'list_type', msg: 'erro com conteúdo sensível', input: 'enunciado que não deve ser armazenado' }],
      }), {
        status: 422,
        headers: { 'x-typesafe-request-id': 'req_safe_123', 'x-ratelimit-limit': '1200', 'x-ratelimit-remaining': '1199' },
      })),
    })

    expect(result.failure).toMatchObject({
      category: 'provider_request_failed', httpStatus: 422, requestId: 'req_safe_123', providerErrorCode: 'invalid_question',
      providerValidationIssues: ['body.questions.bncc_alignment.criteria:list_type'],
      rateLimit: { limit: '1200', remaining: '1199' },
    })
    expect(describeJevFailure(result.failure!)).toContain('campos_inválidos=body.questions.bncc_alignment.criteria:list_type')
    expect(JSON.stringify(store.rows.at(-1)?.context)).toContain('req_safe_123')
    expect(JSON.stringify(store.rows.at(-1)?.context)).not.toContain('não persistir')
    expect(JSON.stringify(store.rows.at(-1)?.context)).not.toContain('texto que não deve ser armazenado')
    expect(JSON.stringify(store.rows.at(-1)?.context)).not.toContain('conteúdo sensível')
    expect(JSON.stringify(store.rows.at(-1)?.context)).not.toContain('enunciado que não deve ser armazenado')
    expect(new JevUnavailableError(result.failure!, 'falha').retryable).toBe(false)
  })

  it('retém Retry-After de 429 para o worker adiar a fila sem consumir tentativa', async () => {
    const result = await evaluateWithJev({
      operation: 'jev/http-429', questionVersion: 'v1', state: {}, questions, route, fallback,
      apiKey: 'key', store: null, telemetry: null, reserveOperation: null,
      fetchImpl: vi.fn(async () => new Response('{}', {
        status: 429,
        headers: { 'retry-after': '7', 'x-request-id': 'req_limited_1' },
      })),
    })

    expect(result.failure).toMatchObject({ category: 'rate_limited', httpStatus: 429, requestId: 'req_limited_1', retryAfterMs: 7000 })
    expect(new JevUnavailableError(result.failure!, 'falha').retryable).toBe(true)
  })

  it('repete connection_error transitório antes de cair no fallback', async () => {
    const store = fakeStore()
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ answers: { aligned: { type: 'noul', noul: 0.9 } } })))
    const result = await evaluateWithJev({
      operation: 'jev/retry', questionVersion: 'v1', state: {}, questions, route, fallback,
      apiKey: 'key', store, telemetry: null, reserveOperation: null, fetchImpl, retryDelaysMs: [0, 0],
    })
    expect(result.source).toBe('provider')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(store.rows.at(-1)).toMatchObject({ status: 'succeeded' })
  })

  it('desiste após esgotar as repetições e não repete erro não transitório', async () => {
    const failing = vi.fn(async () => { throw new TypeError('fetch failed') })
    const exhausted = await evaluateWithJev({
      operation: 'jev/retry-exhausted', questionVersion: 'v1', state: {}, questions, route, fallback,
      apiKey: 'key', store: null, telemetry: null, reserveOperation: null, fetchImpl: failing, retryDelaysMs: [0, 0],
    })
    expect(exhausted).toMatchObject({ source: 'fallback', failure: { category: 'connection_error' } })
    expect(failing).toHaveBeenCalledTimes(3)

    const http422 = vi.fn(async () => new Response('{}', { status: 422 }))
    await evaluateWithJev({
      operation: 'jev/no-retry-422', questionVersion: 'v1', state: {}, questions, route, fallback,
      apiKey: 'key', store: null, telemetry: null, reserveOperation: null, fetchImpl: http422, retryDelaysMs: [0, 0],
    })
    expect(http422).toHaveBeenCalledTimes(1)
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
