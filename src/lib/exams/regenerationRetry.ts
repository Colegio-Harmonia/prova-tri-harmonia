import { StructuredGenerationError } from '@/lib/gemini/structuredRepair'

/**
 * A geração estruturada já tenta reparar a resposta recebida. Quando todas
 * essas tentativas falham por JSON incompleto, validação ou indisponibilidade
 * transitória, uma nova execução completa tem mais chance de começar com uma
 * resposta limpa do que continuar o mesmo prompt de reparo.
 */
const RETRYABLE_FAILURE_CODES = new Set([
  'validation_rejected',
  'empty_response',
  'invalid_json',
  'output_truncated',
  'timeout',
  'rate_limited',
  'provider_unavailable',
  'provider_request_failed',
])

export const MAX_FULL_QUESTION_GENERATION_ATTEMPTS = 2

export function shouldRetryQuestionGeneration(error: unknown): error is StructuredGenerationError {
  return error instanceof StructuredGenerationError && RETRYABLE_FAILURE_CODES.has(error.failureCode)
}
