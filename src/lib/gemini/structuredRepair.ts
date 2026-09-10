import type { ZodType, ZodError } from 'zod'
import { classifyAiFailure, recordAiOperation } from '@/lib/ai/operationTelemetry'
import { AI_BUDGET_EXHAUSTED_CODE, AiBudgetExceededError, reserveAiOperation } from '@/lib/ai/operationBudget'
import { activeAiModel, estimateAiCostMicrousd } from '@/lib/ai/modelProfiles'
import { AiProviderError, generateStructuredCompletion } from './llmClient'

export type StructuredValidation<T> = {
  value: T
  issues: string[]
  warnings?: string[]
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

function buildRepairPrompt(basePrompt: string, issues: string[], attempt: number, maxAttempts: number) {
  return `${basePrompt}

ATENÇÃO: a resposta anterior da IA foi rejeitada na validação estrutural/semântica.
Tentativa de reparo ${attempt + 1} de ${maxAttempts}.

Corrija TODOS os problemas abaixo e devolva a resposta INTEGRAL novamente, no mesmo JSON exigido, sem markdown e sem texto fora do JSON:
${issues.map((issue) => `- ${issue}`).join('\n')}`
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
  maxAttempts = 2,
  validate,
}: GenerateValidatedParams<TParsed, TValue>): Promise<StructuredGenerationResult<TValue>> {
  const attemptsLimit = Math.max(1, maxAttempts)
  let currentPrompt = prompt
  let lastIssues: string[] = []
  let lastFailureCode = 'validation_rejected'
  const warnings: string[] = []

  for (let attempt = 1; attempt <= attemptsLimit; attempt++) {
    let reservation: Awaited<ReturnType<typeof reserveAiOperation>> | undefined
    try {
      reservation = await reserveAiOperation(context)
      const completion = await generateStructuredCompletion(currentPrompt, responseSchema)
      const parsed = zodSchema.safeParse(completion.value)

      if (!parsed.success) {
        lastIssues = formatZodIssues(parsed.error)
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
        lastFailureCode = 'validation_rejected'
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
      await recordAiOperation({ operation: context, provider: profile.provider, model: profile.model, status: 'failed', attempt, durationMs: err instanceof AiProviderError ? err.durationMs : null, errorCode: lastFailureCode, modelProfileId: profile.id })
    } finally {
      reservation?.release()
    }

    console.warn(`[${context}] resposta IA inválida na tentativa ${attempt}/${attemptsLimit}:`, lastIssues)
    if (attempt < attemptsLimit) {
      currentPrompt = buildRepairPrompt(prompt, lastIssues, attempt, attemptsLimit)
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
