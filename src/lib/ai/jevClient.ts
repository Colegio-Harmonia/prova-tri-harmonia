import { createHash } from 'node:crypto'
import { recordAiOperation, type AiOperation } from './operationTelemetry'
import { databaseJevDecisionStore, type JevDecisionStore, type StoredJevDecision } from './jevDecisionStore'
import { AI_BUDGET_EXHAUSTED_CODE, AiBudgetExceededError, reserveAiOperation } from './operationBudget'

const TYPESAFE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const DEFAULT_MODEL = 'jev-latest'
const DEFAULT_TIMEOUT_MS = 8000
const MAX_MEMORY_CACHE_ENTRIES = 500

type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type JevNoulQuestion = { type: 'noul'; instructions: JsonValue; criteria?: JsonValue }
export type JevChoiceQuestion = { type: 'choice'; instructions: JsonValue; criteria: JsonValue }
export type JevScoreQuestion = { type: 'score'; instructions: JsonValue; criteria: string[] }
export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion
export type JevQuestions = Record<string, JevQuestion>

export type JevNoulAnswer = { type: 'noul'; noul: number }
export type JevChoiceAnswer = { type: 'choice'; choice: string; probabilities?: Record<string, number>; confidence?: number }
export type JevScoreAnswer = { type: 'score'; score: number; probabilities?: Record<string, number>; confidence?: number }
export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer
export type JevAnswers = Record<string, JevAnswer>

export type JevRoute = {
  route: 'automatic' | 'review' | 'fallback'
  outcome: string
}

export type JevDecisionResult = {
  model: string
  answers: JevAnswers
  source: 'provider' | 'cache' | 'fallback'
  routing: JevRoute
  stateHash: string
  cacheKey: string
  failure: JevFailureDetails | null
}

/** Diagnóstico seguro da falha HTTP, sem guardar prompt ou resposta bruta do provedor. */
export type JevFailureDetails = {
  category: string
  httpStatus: number | null
  requestId: string | null
  providerErrorCode: string | null
  providerValidationIssues: string[]
  retryAfterMs: number | null
  rateLimit: { limit: string | null; remaining: string | null; reset: string | null }
}

export class JevUnavailableError extends Error {
  readonly retryable: boolean

  constructor(readonly failure: JevFailureDetails, message: string) {
    super(message)
    this.name = 'JevUnavailableError'
    this.retryable = failure.httpStatus === 429 || (failure.httpStatus !== null && failure.httpStatus >= 500)
      || failure.category === 'timeout' || failure.category === 'connection_error'
  }
}

export function describeJevFailure(failure: JevFailureDetails): string {
  const facts = [`categoria=${failure.category}`]
  if (failure.httpStatus !== null) facts.push(`HTTP ${failure.httpStatus}`)
  if (failure.providerErrorCode) facts.push(`código_provedor=${failure.providerErrorCode}`)
  if (failure.providerValidationIssues.length) facts.push(`campos_inválidos=${failure.providerValidationIssues.join(',')}`)
  if (failure.requestId) facts.push(`request_id=${failure.requestId}`)
  if (failure.retryAfterMs !== null) facts.push(`retry_after_ms=${failure.retryAfterMs}`)
  if (failure.rateLimit.limit || failure.rateLimit.remaining || failure.rateLimit.reset) {
    facts.push(`rate_limit=${failure.rateLimit.remaining ?? '?'} de ${failure.rateLimit.limit ?? '?'}; reset=${failure.rateLimit.reset ?? '?'}`)
  }
  return facts.join('; ')
}

type FetchLike = typeof fetch
type MemoryEntry = { model: string; answers: JevAnswers; expiresAt: number }
const memoryCache = new Map<string, MemoryEntry>()

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]))
  }
  return value
}

export function stableJson(value: unknown) {
  return JSON.stringify(stableValue(value))
}

export function hashJevState(state: JsonValue) {
  return createHash('sha256').update(stableJson(state)).digest('hex')
}

export function buildJevCacheKey(input: { operation: string; questionVersion: string; model: string; state: JsonValue; questions: JevQuestions }) {
  return createHash('sha256').update(stableJson(input)).digest('hex')
}

function finiteProbability(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined
}

function probabilities(value: unknown) {
  if (!value || typeof value !== 'object') return undefined
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, probability]) => [key, finiteProbability(probability)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== undefined)
  return entries.length ? Object.fromEntries(entries) : undefined
}

export function parseJevAnswers(questions: JevQuestions, value: unknown): JevAnswers {
  if (!value || typeof value !== 'object') throw new Error('invalid_answers')
  const raw = value as Record<string, unknown>
  const parsed: JevAnswers = {}
  for (const [id, question] of Object.entries(questions)) {
    const answer = raw[id]
    if (!answer || typeof answer !== 'object') throw new Error(`missing_answer:${id}`)
    const item = answer as Record<string, unknown>
    if (question.type === 'noul') {
      const noul = finiteProbability(item.noul)
      if (noul === undefined) throw new Error(`invalid_noul:${id}`)
      parsed[id] = { type: 'noul', noul }
    } else if (question.type === 'choice') {
      if (typeof item.choice !== 'string') throw new Error(`invalid_choice:${id}`)
      parsed[id] = { type: 'choice', choice: item.choice, probabilities: probabilities(item.probabilities), confidence: finiteProbability(item.confidence) }
    } else {
      if (typeof item.score !== 'number' || !Number.isFinite(item.score)) throw new Error(`invalid_score:${id}`)
      parsed[id] = { type: 'score', score: item.score, probabilities: probabilities(item.probabilities), confidence: finiteProbability(item.confidence) }
    }
  }
  return parsed
}

/** Confere localmente o contrato score da TypeSafe antes de abrir uma chamada externa. */
export function validateJevQuestionContract(questions: JevQuestions): string | null {
  for (const [id, question] of Object.entries(questions)) {
    if (question.type === 'score' && (
      !Array.isArray(question.criteria)
      || question.criteria.length < 2
      || question.criteria.length > 10
      || question.criteria.some((criterion) => typeof criterion !== 'string' || criterion.trim().length === 0)
    )) {
      return `invalid_score_criteria:${id}`
    }
  }
  return null
}

function classifyJevFailure(error: unknown) {
  if (error instanceof AiBudgetExceededError) return AI_BUDGET_EXHAUSTED_CODE
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'timeout'
  if (error instanceof JevHttpError) {
    const status = error.status
    if (status === 401 || status === 403) return 'provider_auth'
    if (status === 402) return 'provider_payment_required'
    if (status === 429) return 'rate_limited'
    if (status >= 500) return 'provider_unavailable'
    return 'provider_request_failed'
  }
  if (error instanceof Error && /answer|noul|choice|score/.test(error.message)) return 'invalid_provider_response'
  if (error instanceof TypeError) return 'connection_error'
  return 'unexpected_failure'
}

class JevHttpError extends Error {
  constructor(readonly status: number, readonly failure: JevFailureDetails) {
    super(`typesafe_http_${status}`)
    this.name = 'JevHttpError'
  }
}

function safeHeader(response: Response, ...names: string[]): string | null {
  for (const name of names) {
    const value = response.headers.get(name)?.trim()
    if (value) return value.slice(0, 120).replace(/[\r\n\0]/g, '')
  }
  return null
}

function retryAfterMs(response: Response, now = Date.now()): number | null {
  const milliseconds = response.headers.get('retry-after-ms')
  if (milliseconds && /^\d+(?:\.\d+)?$/.test(milliseconds)) return Math.min(86_400_000, Math.max(0, Math.round(Number(milliseconds))))
  const value = response.headers.get('retry-after')
  if (!value) return null
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.min(86_400_000, Math.max(0, Math.round(Number(value) * 1000)))
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.min(86_400_000, Math.max(0, date - now)) : null
}

function safeProviderErrorCode(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const root = body as Record<string, unknown>
  const error = root.error && typeof root.error === 'object' && !Array.isArray(root.error)
    ? root.error as Record<string, unknown>
    : root
  const code = error.code ?? error.type
  return typeof code === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(code) ? code : null
}

function safeProviderValidationIssues(body: unknown): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return []
  const root = body as Record<string, unknown>
  const detail = Array.isArray(root.detail) ? root.detail : Array.isArray(root.errors) ? root.errors : []
  return detail.slice(0, 8).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const issue = entry as Record<string, unknown>
    const loc = Array.isArray(issue.loc) ? issue.loc : Array.isArray(issue.path) ? issue.path : []
    const path = loc.slice(0, 8).map((part) => String(part))
      .filter((part) => /^[a-zA-Z0-9_-]{1,80}$/.test(part))
      .join('.')
    const code = typeof issue.type === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(issue.type) ? issue.type : null
    return path && code ? [`${path}:${code}`] : []
  })
}

async function responseFailure(response: Response): Promise<JevFailureDetails> {
  let bodyCode: string | null = null
  let providerValidationIssues: string[] = []
  try {
    const body = await response.clone().json()
    bodyCode = safeProviderErrorCode(body)
    providerValidationIssues = safeProviderValidationIssues(body)
  } catch { /* Corpo bruto nunca é persistido. */ }
  return {
    category: '',
    httpStatus: response.status,
    requestId: safeHeader(response, 'x-typesafe-request-id', 'x-request-id', 'request-id'),
    providerErrorCode: safeHeader(response, 'x-typesafe-error-code', 'x-error-code') ?? bodyCode,
    providerValidationIssues,
    retryAfterMs: retryAfterMs(response),
    rateLimit: {
      limit: safeHeader(response, 'x-ratelimit-limit', 'ratelimit-limit'),
      remaining: safeHeader(response, 'x-ratelimit-remaining', 'ratelimit-remaining'),
      reset: safeHeader(response, 'x-ratelimit-reset', 'ratelimit-reset'),
    },
  }
}

function failureWithoutResponse(category: string, providerErrorCode: string | null = null): JevFailureDetails {
  return { category, httpStatus: null, requestId: null, providerErrorCode, providerValidationIssues: [], retryAfterMs: null, rateLimit: { limit: null, remaining: null, reset: null } }
}

function remember(cacheKey: string, entry: MemoryEntry) {
  memoryCache.delete(cacheKey)
  memoryCache.set(cacheKey, entry)
  while (memoryCache.size > MAX_MEMORY_CACHE_ENTRIES) memoryCache.delete(memoryCache.keys().next().value as string)
}

async function safelyRecord(store: JevDecisionStore | null, decision: StoredJevDecision) {
  if (!store) return
  try { await store.record(decision) } catch { console.warn('[jev] falha ao registrar decisão') }
}

export async function evaluateWithJev(options: {
  operation: string
  questionVersion: string
  state: JsonValue
  questions: JevQuestions
  route: (answers: JevAnswers) => JevRoute
  fallback: { answers: JevAnswers; routing: JevRoute }
  context?: Record<string, JsonValue>
  cacheTtlMs?: number
  apiKey?: string
  model?: string
  endpoint?: string
  timeoutMs?: number
  fetchImpl?: FetchLike
  store?: JevDecisionStore | null
  telemetry?: ((operation: AiOperation) => Promise<void>) | null
  reserveOperation?: ((operation: string) => Promise<{ release: () => void }>) | null
  now?: Date
}): Promise<JevDecisionResult> {
  const now = options.now ?? new Date()
  const model = options.model ?? process.env.TYPESAFE_MODEL ?? DEFAULT_MODEL
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY
  const stateHash = hashJevState(options.state)
  const cacheKey = buildJevCacheKey({ operation: options.operation, questionVersion: options.questionVersion, model, state: options.state, questions: options.questions })
  const cacheTtlMs = Math.max(0, options.cacheTtlMs ?? 0)
  const store = options.store === undefined ? databaseJevDecisionStore : options.store
  const telemetry = options.telemetry === undefined ? recordAiOperation : options.telemetry
  const reserveOperation = options.reserveOperation === undefined ? reserveAiOperation : options.reserveOperation
  const base = { operation: options.operation, questionVersion: options.questionVersion, stateHash, cacheKey, context: options.context ?? null }

  const invalidContract = validateJevQuestionContract(options.questions)
  if (invalidContract) {
    const [providerErrorCode, questionId] = invalidContract.split(':')
    const failure = failureWithoutResponse('invalid_request', providerErrorCode ?? 'invalid_question_contract')
    await safelyRecord(store, { ...base, context: { ...(base.context ?? {}), failure, invalidQuestionId: questionId ?? null }, model, source: 'fallback', status: 'failed', route: options.fallback.routing.route, outcome: options.fallback.routing.outcome, answers: options.fallback.answers, durationMs: 0, errorCode: failure.category, cacheExpiresAt: null })
    if (telemetry) await telemetry({ operation: options.operation, provider: 'typesafe', model, status: 'failed', attempt: 0, durationMs: 0, errorCode: failure.category })
    return { model, answers: options.fallback.answers, source: 'fallback', routing: options.fallback.routing, stateHash, cacheKey, failure }
  }

  if (cacheTtlMs > 0) {
    let cached = memoryCache.get(cacheKey)
    if (cached && cached.expiresAt <= now.getTime()) { memoryCache.delete(cacheKey); cached = undefined }
    if (!cached && store) {
      try {
        const persisted = await store.findCached(cacheKey, now)
        if (persisted?.cacheExpiresAt) cached = { model: persisted.model, answers: parseJevAnswers(options.questions, persisted.answers), expiresAt: persisted.cacheExpiresAt.getTime() }
      } catch { console.warn('[jev] cache persistente indisponível') }
    }
    if (cached) {
      const routing = options.route(cached.answers)
      await safelyRecord(store, { ...base, model: cached.model, source: 'cache', status: 'succeeded', route: routing.route, outcome: routing.outcome, answers: cached.answers, durationMs: 0, errorCode: null, cacheExpiresAt: new Date(cached.expiresAt) })
      return { model: cached.model, answers: cached.answers, source: 'cache', routing, stateHash, cacheKey, failure: null }
    }
  }

  if (!apiKey) {
    const failure = failureWithoutResponse('provider_not_configured')
    await safelyRecord(store, { ...base, context: { ...(base.context ?? {}), failure }, model, source: 'fallback', status: 'failed', route: options.fallback.routing.route, outcome: options.fallback.routing.outcome, answers: options.fallback.answers, durationMs: 0, errorCode: 'provider_not_configured', cacheExpiresAt: null })
    return { model, answers: options.fallback.answers, source: 'fallback', routing: options.fallback.routing, stateHash, cacheKey, failure }
  }

  const startedAt = Date.now()
  let reservation: { release: () => void } | undefined
  try {
    reservation = reserveOperation ? await reserveOperation(options.operation) : undefined
    const response = await (options.fetchImpl ?? fetch)(options.endpoint ?? TYPESAFE_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, state: options.state, questions: options.questions }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
    if (!response.ok) throw new JevHttpError(response.status, await responseFailure(response))
    const body = await response.json() as { model?: unknown; answers?: unknown; usage?: unknown }
    const resolvedModel = typeof body.model === 'string' ? body.model : model
    const answers = parseJevAnswers(options.questions, body.answers)
    const routing = options.route(answers)
    const durationMs = Date.now() - startedAt
    const cacheExpiresAt = cacheTtlMs > 0 ? new Date(now.getTime() + cacheTtlMs) : null
    if (cacheExpiresAt) remember(cacheKey, { model: resolvedModel, answers, expiresAt: cacheExpiresAt.getTime() })
    await safelyRecord(store, { ...base, model: resolvedModel, source: 'provider', status: 'succeeded', route: routing.route, outcome: routing.outcome, answers, durationMs, errorCode: null, cacheExpiresAt })
    if (telemetry) await telemetry({ operation: options.operation, provider: 'typesafe', model: resolvedModel, status: 'succeeded', attempt: 1, durationMs })
    return { model: resolvedModel, answers, source: 'provider', routing, stateHash, cacheKey, failure: null }
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const errorCode = classifyJevFailure(error)
    const failure = error instanceof JevHttpError
      ? { ...error.failure, category: errorCode }
      : failureWithoutResponse(errorCode)
    await safelyRecord(store, { ...base, context: { ...(base.context ?? {}), failure }, model, source: 'fallback', status: 'failed', route: options.fallback.routing.route, outcome: options.fallback.routing.outcome, answers: options.fallback.answers, durationMs, errorCode, cacheExpiresAt: null })
    if (telemetry) await telemetry({ operation: options.operation, provider: 'typesafe', model, status: error instanceof AiBudgetExceededError ? 'rejected' : 'failed', attempt: 1, durationMs, errorCode })
    return { model, answers: options.fallback.answers, source: 'fallback', routing: options.fallback.routing, stateHash, cacheKey, failure }
  } finally {
    reservation?.release()
  }
}
