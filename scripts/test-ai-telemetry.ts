import assert from 'node:assert/strict'
import axios from 'axios'
import { normalizeAiUsage, classifyAiFailure } from '../src/lib/ai/operationTelemetry'
import { isAiOperationBudgetExhausted, parseAiDailyOperationBudget } from '../src/lib/ai/operationBudget'
import { AiProviderError } from '../src/lib/gemini/llmClient'

assert.deepEqual(normalizeAiUsage({ prompt_tokens: 120.4, completion_tokens: 34, total_tokens: 154 }), {
  promptTokens: 120,
  completionTokens: 34,
  totalTokens: 154,
})
assert.deepEqual(normalizeAiUsage({ prompt_tokens: -1, completion_tokens: '34' }), {
  promptTokens: null,
  completionTokens: null,
  totalTokens: null,
})

const rateLimited = new axios.AxiosError('too many requests', undefined, undefined, undefined, { status: 429, statusText: 'Too Many Requests', headers: {}, config: { headers: new axios.AxiosHeaders() }, data: null })
assert.equal(classifyAiFailure(new AiProviderError('provider failure', 10, rateLimited)), 'rate_limited')
assert.equal(classifyAiFailure(new AiProviderError('invalid response', 10)), 'invalid_provider_response')
assert.equal(classifyAiFailure(new AiProviderError('not configured', 0, undefined, 'provider_not_configured')), 'provider_not_configured')

assert.equal(parseAiDailyOperationBudget(undefined), 50)
assert.equal(parseAiDailyOperationBudget('0'), 0)
assert.equal(parseAiDailyOperationBudget('12'), 12)
assert.equal(parseAiDailyOperationBudget('-1'), 50)
assert.equal(isAiOperationBudgetExhausted({ completed: 49, pending: 1, limit: 50 }), true)
assert.equal(isAiOperationBudgetExhausted({ completed: 49, pending: 0, limit: 50 }), false)

console.log('AI telemetry and budget helpers: OK')
