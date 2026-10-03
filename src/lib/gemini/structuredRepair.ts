import type { ZodType, ZodError } from 'zod'
import { classifyAiFailure, recordAiOperation } from '@/lib/ai/operationTelemetry'
import { AI_BUDGET_EXHAUSTED_CODE, AiBudgetExceededError, reserveAiOperation } from '@/lib/ai/operationBudget'
import { activeAiModel, estimateAiCostMicrousd } from '@/lib/ai/modelProfiles'
import { AiProviderError, generateStructuredCompletion } from './llmClient'

export type StructuredValidation<T> = {
  value: T
  issues: string[]
  warnings?: string[]
  /** Interrompe as tentativas quando corrigir o JSON não resolve o problema. */
  stopRetry?: boolean
  /** Diagnóstico opcional, serializável e próprio para a próxima tentativa. */
  repairInstructions?: Array<{
    code: string
    fields?: string[]
    message: string
    protectedFields?: string[]
  }>
}

export type StructuredGenerationResult<T> = {
  value: T
  warnings: string[]
  attempts: number
  repaired: boolean
}

type GenerateValidatedParams<TParsed, TValue> = {
  context: string
  prompt: string
  responseSchema: object
  zodSchema: ZodType<TParsed, any, unknown>
  maxAttempts?: number
  validate?: (parsed: TParsed) => StructuredValidation<TValue> | Promise<StructuredValidation<TValue>>
}

export class StructuredGenerationError extends Error {
  constructor(
    message: string,
    public readonly context: string,
    public readonly attempts: number,
    public readonly issues: string[],
    public readonly failureCode: string,
  ) {
    super(message)
    this.name = 'StructuredGenerationError'
  }
}

function formatZodIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : '(raiz)'
    return `${path}: ${issue.message}`
  })
}

function buildRepairPrompt(basePrompt: string, issues: string[], attempt: number, maxAttempts: number, repairInstructions: StructuredValidation<unknown>['repairInstructions']) {
  const instructions = repairInstructions?.length
    ? JSON.stringify(repairInstructions)
    : JSON.stringify(issues.map((message) => ({ code: 'INVALID_AI_RESPONSE', message })))
  return `${basePrompt}

ATENÇÃO: a resposta anterior da IA foi rejeitada na validação estrutural/semântica.
Tentativa de reparo ${attempt + 1} de ${maxAttempts}.

DIAGNÓSTICO E PLANO DE REPARO (JSON):
${instructions}

Corrija TODOS os problemas acima. Preserve qualquer campo listado em protectedFields. Devolva a resposta INTEGRAL novamente, no mesmo JSON exigido, sem markdown e sem texto fora do JSON.`
}

/** Ajuste por responsabilidade: fatos e JSON ganham estabilidade; redação ganha variedade. */
function completionOptionsFor(context: string): { temperature: number; maxTokens: number } {
  // O pipeline unificado pede um objeto grande e estrito. No DeepSeek, uma
  // temperatura menor reduz respostas parcialmente estruturadas e, portanto,
  // evita que uma falha de JSON encerre a questão antes da reparação local.
  if (/generation\/unified(?:-|$)/.test(context)) return { temperature: 0.2, maxTokens: 5_000 }
  if (/generation\/stage[01](?:-|$)|generation\/stage_visual/.test(context)) return { temperature: 0.15, maxTokens: 1_800 }
  if (/generation\/stage2/.test(context)) return { temperature: 0.45, maxTokens: 1_600 }
  if (/generation\/stage3/.test(context)) return { temperature: 0.72, maxTokens: 2_400 }
  if (/generation\/stage[45]/.test(context)) return { temperature: 0.25, maxTokens: 2_400 }
  // No gpt-5-mini os tokens de raciocínio contam contra max_completion_tokens:
  // a auditoria gasta ~2,7 mil só raciocinando (~3,5-4,5 mil no total), e com
  // 2.400 o JSON nunca era emitido (empty_response). É só um teto, não gasto.
  if (/question-quality-test|exam-quality-audit/.test(context)) return { temperature: 0.15, maxTokens: 16_000 }
  return { temperature: 0.5, maxTokens: 4_000 }
}

const TRANSIENT_PROVIDER_FAILURES = new Set([
  'empty_response',
  'invalid_json',
  'output_truncated',
  'timeout',
  'rate_limited',
  'provider_unavailable',
  'provider_request_failed',
])

function providerRetryDelayMs(attempt: number): number {
  // Backoff curto com jitter: repete uma falha transitória sem transformar a
  // mensagem de erro do provedor em "feedback" de conteúdo para o modelo.
  return Math.min(8_000, 1_000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400)
}

/**
 * Gera JSON estruturado, valida com Zod, aplica validação semântica opcional
 * e faz reparo limitado por prompt. DeepSeek garante JSON sintático, mas não
 * garante shape nem regras de negócio; este helper é o gate único antes de
 * qualquer resposta de IA ser persistida.
 */
export async function generateValidatedStructuredContent<TParsed, TValue = TParsed>({
  context,
  prompt,
  responseSchema,
  zodSchema,
  maxAttempts = 3,
  validate,
}: GenerateValidatedParams<TParsed, TValue>): Promise<StructuredGenerationResult<TValue>> {
  const attemptsLimit = Math.max(1, maxAttempts)
  let currentPrompt = prompt
  let lastIssues: string[] = []
  let lastRepairInstructions: StructuredValidation<unknown>['repairInstructions'] = []
  let lastFailureCode = 'validation_rejected'
  const warnings: string[] = []

  for (let attempt = 1; attempt <= attemptsLimit; attempt++) {
    let reservation: Awaited<ReturnType<typeof reserveAiOperation>> | undefined
    let stoppedValidation: StructuredValidation<unknown> | null = null
    try {
      reservation = await reserveAiOperation(context)
      const completion = await generateStructuredCompletion(currentPrompt, responseSchema, completionOptionsFor(context))
      const parsed = zodSchema.safeParse(completion.value)

      if (!parsed.success) {
        lastIssues = formatZodIssues(parsed.error)
        lastRepairInstructions = parsed.error.issues.map((issue) => ({
          code: 'INVALID_AI_RESPONSE',
          fields: issue.path.map(String),
          message: issue.message,
        }))
        lastFailureCode = 'validation_rejected'
      } else {
        const validation = validate
          ? await validate(parsed.data)
          : ({ value: parsed.data as unknown as TValue, issues: [], warnings: [] } satisfies StructuredValidation<TValue>)

        if (validation.issues.length === 0) {
          warnings.push(...(validation.warnings ?? []))
          await recordAiOperation({ operation: context, provider: completion.provider, model: completion.model, status: 'succeeded', attempt, durationMs: completion.durationMs, usage: completion.usage, modelProfileId: completion.profile.id, estimatedCostMicrousd: estimateAiCostMicrousd({ model: completion.profile, promptTokens: completion.usage.promptTokens, completionTokens: completion.usage.completionTokens }) })
          return {
            value: validation.value,
            warnings,
            attempts: attempt,
            repaired: attempt > 1,
          }
        }

        lastIssues = validation.issues
        lastRepairInstructions = validation.repairInstructions
        lastFailureCode = 'validation_rejected'
        if (validation.stopRetry) stoppedValidation = validation
      }
      await recordAiOperation({ operation: context, provider: completion.provider, model: completion.model, status: 'rejected', attempt, durationMs: completion.durationMs, usage: completion.usage, errorCode: 'validation_rejected', modelProfileId: completion.profile.id, estimatedCostMicrousd: estimateAiCostMicrousd({ model: completion.profile, promptTokens: completion.usage.promptTokens, completionTokens: completion.usage.completionTokens }) })
    } catch (err) {
      const profile = await activeAiModel('text_generation')
      if (err instanceof AiBudgetExceededError) {
        await recordAiOperation({ operation: context, provider: profile.provider, model: profile.model, status: 'failed', attempt, durationMs: null, errorCode: AI_BUDGET_EXHAUSTED_CODE, modelProfileId: profile.id })
        throw err
      }
      lastFailureCode = classifyAiFailure(err)
      lastIssues = ['Falha operacional ao chamar o provedor de IA.']
      lastRepairInstructions = [{ code: 'PROVIDER_FAILURE', message: 'A chamada anterior não retornou uma resposta utilizável. Gere novamente o mesmo JSON completo.' }]
      await recordAiOperation({ operation: context, provider: profile.provider, model: profile.model, status: 'failed', attempt, durationMs: err instanceof AiProviderError ? err.durationMs : null, errorCode: lastFailureCode, modelProfileId: profile.id })
    } finally {
      reservation?.release()
    }

    if (stoppedValidation) {
      throw new StructuredGenerationError(
        'A resposta exige uma estratégia de geração diferente.',
        context,
        attempt,
        stoppedValidation.issues,
        'validation_rejected',
      )
    }

    console.warn(`[${context}] resposta IA inválida na tentativa ${attempt}/${attemptsLimit}:`, lastIssues)
    if (attempt < attemptsLimit) {
      if (TRANSIENT_PROVIDER_FAILURES.has(lastFailureCode)) {
        await new Promise<void>((resolve) => setTimeout(resolve, providerRetryDelayMs(attempt)))
        currentPrompt = prompt
      } else {
        currentPrompt = buildRepairPrompt(prompt, lastIssues, attempt, attemptsLimit, lastRepairInstructions)
      }
    }
  }

  console.error(`[${context}] limite de tentativas de reparo atingido; resposta IA descartada:`, lastIssues)
  throw new StructuredGenerationError(
    `Resposta da IA inválida após ${attemptsLimit} tentativa(s).`,
    context,
    attemptsLimit,
    lastIssues,
    lastFailureCode,
  )
}
