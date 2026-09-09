import axios from 'axios'
import { db } from '@/db/client'
import { aiOperations } from '@/db/schema'

export type AiOperationStatus = 'succeeded' | 'rejected' | 'failed'

export type AiUsage = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
}

export type AiOperation = {
  operation: string
  provider: string
  model: string
  status: AiOperationStatus
  attempt: number
  durationMs: number | null
  usage?: AiUsage
  errorCode?: string | null
  modelProfileId?: number | null
  estimatedCostMicrousd?: number | null
}

export function normalizeAiUsage(usage: unknown): AiUsage {
  const value = usage && typeof usage === 'object' ? usage as Record<string, unknown> : {}
  const numberOrNull = (input: unknown) => typeof input === 'number' && Number.isFinite(input) && input >= 0 ? Math.round(input) : null

  return {
    promptTokens: numberOrNull(value.prompt_tokens),
    completionTokens: numberOrNull(value.completion_tokens),
    totalTokens: numberOrNull(value.total_tokens),
  }
}

// Não persiste a mensagem do erro: provedores podem devolver trechos do
// prompt/saída. A categoria basta para a operação e reduz exposição de dados.
export function classifyAiFailure(error: unknown): string {
  if (error instanceof Error && error.name === 'AiProviderError') {
    const failureCode = (error as Error & { failureCode?: string }).failureCode
    if (failureCode) return failureCode
    const cause = (error as Error & { cause?: unknown }).cause
    return cause ? classifyAiFailure(cause) : 'invalid_provider_response'
  }

  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') return 'timeout'
    const status = error.response?.status
    if (status === 401 || status === 403) return 'provider_auth'
    if (status === 429) return 'rate_limited'
    if (status && status >= 500) return 'provider_unavailable'
    return 'provider_request_failed'
  }

  return 'unexpected_failure'
}

export async function recordAiOperation(operation: AiOperation): Promise<void> {
  try {
    await db.insert(aiOperations).values({
      operation: operation.operation,
      provider: operation.provider,
      model: operation.model,
      status: operation.status,
      attempt: operation.attempt,
      promptTokens: operation.usage?.promptTokens ?? null,
      completionTokens: operation.usage?.completionTokens ?? null,
      totalTokens: operation.usage?.totalTokens ?? null,
      durationMs: operation.durationMs,
      errorCode: operation.errorCode ?? null,
      modelProfileId: operation.modelProfileId ?? null,
      estimatedCostMicrousd: operation.estimatedCostMicrousd ?? null,
    })
  } catch {
    // Observabilidade não pode interromper geração/correção. Não logar o erro
    // bruto aqui evita vazar conteúdo eventualmente repetido por um driver.
    console.warn('[ai-telemetry] falha ao registrar operação')
  }
}
