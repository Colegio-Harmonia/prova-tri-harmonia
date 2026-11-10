import axios from 'axios'
import { GEMINI_RESPONSE_SCHEMA } from './examSchema'
import { classifyAiFailure, normalizeAiUsage, recordAiOperation, type AiUsage } from '@/lib/ai/operationTelemetry'
import { AI_BUDGET_EXHAUSTED_CODE, AiBudgetExceededError, reserveAiOperation } from '@/lib/ai/operationBudget'
import { activeAiModel, estimateAiCostMicrousd, type ActiveAiModel } from '@/lib/ai/modelProfiles'
import { parseResponseJson } from './responseJson'
import { getTextFallbackModel } from '@/lib/ai/textFallback'
import { canUseTextFallback, providerFailureMessage } from '@/lib/ai/providerFailure'

// Trocado de Gemini pra DeepSeek (14/07/2026) — o crédito pré-pago do
// Gemini acabou e a escola não tem orçamento pra recarregar toda hora.
// Mesma interface (generateStructuredContent/llmAvailable) pra não precisar
// tocar nas rotas que já consomem isso. Fica só nesse arquivo (pasta
// `gemini/` por histórico, não por dependência — examSchema/promptBuilder
// não são específicos de nenhum provedor).
//
// DIFERENÇA IMPORTANTE em relação ao Gemini: a API do DeepSeek não tem um
// campo separado de responseSchema que restrinja a geração no servidor —
// só um response_format:{type:"json_object"} que garante JSON sintaticamente
// válido, não a ESTRUTURA certa. Por isso o schema completo vai embutido no
// texto do prompt aqui (ver buildJsonInstruction) — sem isso o modelo não
// tem como saber os nomes de campo esperados. A validação real de estrutura
// continua no zod (examSchema.ts) + no retry de examValidator, como já era.
const DEEPSEEK_BASE = 'https://api.deepseek.com'
const OPENAI_BASE = 'https://api.openai.com/v1'
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_MODEL = 'deepseek-v4-flash' // mais barato; "deepseek-v4-pro" fica melhor mas custa mais

export async function llmAvailable(): Promise<boolean> {
  const profile = await activeAiModel('text_generation')
  const configured = (model: ActiveAiModel) => Boolean(model.provider === 'deepseek' ? process.env.DEEPSEEK_API_KEY : model.provider === 'openai' ? process.env.OPENAI_API_KEY : model.provider === 'gemini' ? process.env.GEMINI_API_KEY : undefined)
  if (configured(profile)) return true
  const fallback = await getTextFallbackModel()
  return Boolean(fallback && fallback.provider !== profile.provider && configured(fallback))
}

export class AiProviderError extends Error {
  profile?: ActiveAiModel
  constructor(message: string, public readonly durationMs: number, public readonly cause?: unknown, public readonly failureCode?: string, public readonly responseText?: string, public readonly usage?: AiUsage) {
    super(message)
    this.name = 'AiProviderError'
  }
}

export type StructuredCompletion = {
  value: unknown
  provider: 'deepseek' | 'openai' | 'gemini'
  model: string
  usage: AiUsage
  durationMs: number
  profile: ActiveAiModel
}

export type StructuredCompletionOptions = {
  /** Temperatura menor privilegia aderência ao contrato; maior, variedade textual. */
  temperature?: number
  /** Evita gastar a janela de resposta com raciocínio na geração da prova inteira. */
  reasoningEffort?: 'minimal'
}

function buildJsonInstruction(schema: object): string {
  return (
    `\n\nResponda ESTRITAMENTE em JSON válido, sem markdown, sem texto fora do JSON, ` +
    `seguindo EXATAMENTE esta estrutura (nomes de campo em inglês, valores em português quando for texto livre):\n` +
    JSON.stringify(schema)
  )
}

// `schema` é opcional pra manter a assinatura antiga funcionando em todo
// call site existente (prova inteira) — regenerate-question passa
// SINGLE_QUESTION_RESPONSE_SCHEMA pra pedir só 1 questão em vez da prova.
export async function generateStructuredCompletion(prompt: string, schema: object = GEMINI_RESPONSE_SCHEMA, options: StructuredCompletionOptions = {}): Promise<StructuredCompletion> {
  const profile = await activeAiModel('text_generation')
  // Uma reserva só é usada se a gestão a escolheu explicitamente e pertence
  // a outro provedor. Nunca seleciona qualquer perfil desativado do catálogo.
  const fallback = await getTextFallbackModel()
  const reserve = fallback?.provider !== profile.provider ? fallback : null
  const key = `${profile.id}:${profile.provider}:${profile.model}`
  if (reserve && (paymentCooldowns.get(key) ?? 0) > Date.now()) {
    return generateCompletionWithProfile(reserve, prompt, schema, options)
  }
  try {
    return await generateCompletionWithProfile(profile, prompt, schema, options)
  } catch (error) {
    const code = classifyAiFailure(error)
    if (!reserve || !canUseTextFallback(code)) throw error
    if (code === 'provider_payment_required') paymentCooldowns.set(key, Date.now() + 5 * 60_000)
    await recordAiOperation({ operation: 'text_generation/provider-fallback', provider: profile.provider, model: profile.model, modelProfileId: profile.id, status: 'failed', attempt: 1, durationMs: error instanceof AiProviderError ? error.durationMs : null, errorCode: code })
    console.warn('[ai-fallback] usando reserva configurada', { provider: profile.provider, model: profile.model, failureCode: code, fallbackProvider: reserve.provider, fallbackModel: reserve.model })
    return generateCompletionWithProfile(reserve, prompt, schema, options)
  }
}

const paymentCooldowns = new Map<string, number>()

async function generateCompletionWithProfile(profile: ActiveAiModel, prompt: string, schema: object, options: StructuredCompletionOptions): Promise<StructuredCompletion> {
  if (profile.provider !== 'deepseek' && profile.provider !== 'openai' && profile.provider !== 'gemini') {
    const error = new AiProviderError('O perfil de texto ativo ainda não possui adaptador habilitado.', 0, undefined, 'provider_not_implemented')
    error.profile = profile
    throw error
  }
  const apiKey = profile.provider === 'openai'
    ? process.env.OPENAI_API_KEY
    : profile.provider === 'gemini'
      ? process.env.GEMINI_API_KEY
      : process.env.DEEPSEEK_API_KEY
  const keyName = profile.provider === 'openai' ? 'OPENAI_API_KEY' : profile.provider === 'gemini' ? 'GEMINI_API_KEY' : 'DEEPSEEK_API_KEY'
  if (!apiKey) {
    const error = new AiProviderError(`${keyName} não configurado`, 0, undefined, 'provider_not_configured')
    error.profile = profile
    throw error
  }
  const model = profile.model || (profile.provider === 'openai' ? 'gpt-4.1-mini' : profile.provider === 'gemini' ? 'gemini-3.7-flash' : DEFAULT_MODEL)
  const temperature = options.temperature ?? 0.6
  const startedAt = Date.now()

  try {
    const request = profile.provider === 'openai'
      ? {
          url: `${OPENAI_BASE}/chat/completions`,
          body: {
            model,
            messages: [{ role: 'user', content: prompt + buildJsonInstruction(schema) }],
            response_format: { type: 'json_object' },
            // A família GPT-5 aceita somente a temperatura padrão (1).
            ...(model.startsWith('gpt-5') ? {} : { temperature }),
            ...(model === 'gpt-5-mini' && options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
          },
        }
      : profile.provider === 'gemini'
        ? {
            url: `${GEMINI_BASE}/${model}:generateContent`,
            body: {
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: schema,
                temperature,
              },
            },
            headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
          }
      : {
          url: `${DEEPSEEK_BASE}/chat/completions`,
          body: {
            model,
            messages: [{ role: 'user', content: prompt + buildJsonInstruction(schema) }],
            response_format: { type: 'json_object' },
            // A geração de prova exige objetos JSON curtos e validados. O
            // modo de raciocínio do DeepSeek aumenta respostas vazias ou
            // incompletas nesse contrato, sem acrescentar garantia estrutural.
            thinking: { type: 'disabled' },
            temperature,
          },
        }
    const { data } = await axios.post(
      request.url,
      request.body,
      {
        headers: request.headers ?? { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 120000,
      },
    )

    const text = profile.provider === 'gemini'
      ? data?.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => typeof part.text === 'string')?.text
      : data?.choices?.[0]?.message?.content
    const finishReason = profile.provider === 'gemini' ? data?.candidates?.[0]?.finishReason : data?.choices?.[0]?.finish_reason
    const durationMs = Date.now() - startedAt
    if (typeof text !== 'string' || !text.trim()) {
      throw new AiProviderError(`${profile.provider === 'openai' ? 'OpenAI' : profile.provider === 'gemini' ? 'Gemini' : 'DeepSeek'} não retornou conteúdo.`, durationMs, undefined, 'empty_response')
    }
    if (finishReason === 'length' || finishReason === 'MAX_TOKENS') {
      throw new AiProviderError(`${profile.provider === 'openai' ? 'OpenAI' : profile.provider === 'gemini' ? 'Gemini' : 'DeepSeek'} cortou a resposta por limite de tokens.`, durationMs, undefined, 'output_truncated')
    }

    const usage = profile.provider === 'gemini'
        ? normalizeAiUsage({ prompt_tokens: data?.usageMetadata?.promptTokenCount, completion_tokens: data?.usageMetadata?.candidatesTokenCount, total_tokens: data?.usageMetadata?.totalTokenCount })
        : normalizeAiUsage(data?.usage)
    try {
      const parsed = parseResponseJson(text)
      if (parsed.repaired) console.info('[ai-json] formatação corrigida localmente; conteúdo seguirá para validação.')
      return { value: parsed.value, provider: profile.provider, model, usage, durationMs, profile }
    } catch {
      throw new AiProviderError(`${profile.provider === 'openai' ? 'OpenAI' : profile.provider === 'gemini' ? 'Gemini' : 'DeepSeek'} retornou JSON inválido.`, durationMs, undefined, 'invalid_json', text, usage)
    }
  } catch (error) {
    if (error instanceof AiProviderError) {
      error.profile = profile
      throw error
    }
    const code = classifyAiFailure(error)
    const failure = new AiProviderError(code === 'provider_payment_required' ? providerFailureMessage(code) : 'Falha ao chamar o provedor de IA.', Date.now() - startedAt, error, code)
    failure.profile = profile
    throw failure
  }
}

// Mantém o contrato antigo para os consumidores sem reparo estruturado.
export async function generateStructuredContent(prompt: string, schema: object = GEMINI_RESPONSE_SCHEMA, operation?: string): Promise<unknown> {
  let reservation: Awaited<ReturnType<typeof reserveAiOperation>> | undefined
  let profile: ActiveAiModel | undefined
  try {
    reservation = await reserveAiOperation(operation ?? 'text_generation')
    const completion = await generateStructuredCompletion(prompt, schema)
    profile = completion.profile
    if (operation) await recordAiOperation({ operation, provider: completion.provider, model: completion.model, status: 'succeeded', attempt: 1, durationMs: completion.durationMs, usage: completion.usage, modelProfileId: completion.profile.id, estimatedCostMicrousd: estimateAiCostMicrousd({ model: completion.profile, promptTokens: completion.usage.promptTokens, completionTokens: completion.usage.completionTokens }) })
    return completion.value
  } catch (error) {
    if (operation) {
      const failedProfile = (error instanceof AiProviderError ? error.profile : undefined) ?? profile ?? await activeAiModel('text_generation')
      await recordAiOperation({
        operation,
        provider: failedProfile.provider,
        model: failedProfile.model || (process.env.DEEPSEEK_MODEL || DEFAULT_MODEL),
        status: 'failed',
        attempt: 1,
        durationMs: error instanceof AiProviderError ? error.durationMs : null,
        errorCode: error instanceof AiBudgetExceededError ? AI_BUDGET_EXHAUSTED_CODE : classifyAiFailure(error),
      })
    }
    throw error
  } finally {
    reservation?.release()
  }
}
