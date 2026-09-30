import { describe, expect, it } from 'vitest'
import { StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import { shouldRetryQuestionGeneration } from './regenerationRetry'

const generationError = (failureCode: string) => new StructuredGenerationError(
  'invalid response',
  'generation/unified-1',
  3,
  ['invalid response'],
  failureCode,
)

describe('shouldRetryQuestionGeneration', () => {
  it.each([
    'validation_rejected',
    'empty_response',
    'invalid_json',
    'output_truncated',
    'timeout',
    'rate_limited',
    'provider_unavailable',
    'provider_request_failed',
  ])('retries a transient or invalid structured response: %s', (failureCode) => {
    expect(shouldRetryQuestionGeneration(generationError(failureCode))).toBe(true)
  })

  it('does not retry budget or programming errors', () => {
    expect(shouldRetryQuestionGeneration(generationError('daily_operation_budget_exhausted'))).toBe(false)
    expect(shouldRetryQuestionGeneration(new Error('unexpected'))).toBe(false)
  })
})
