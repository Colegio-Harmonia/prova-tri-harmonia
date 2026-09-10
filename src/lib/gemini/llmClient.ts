import axios from 'axios'
import { GEMINI_RESPONSE_SCHEMA } from './examSchema'
import { normalizeAiUsage, recordAiOperation, type AiUsage } from '@/lib/ai/operationTelemetry'
import { AI_BUDGET_EXHAUSTED_CODE, AiBudgetExceededError, reserveAiOperation } from '@/lib/ai/operationBudget'
import { activeAiModel, estimateAiCostMicrousd, type ActiveAiModel } from '@/lib/ai/modelProfiles'

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
const DEFAULT_MODEL = 'deepseek-v4-flash' // mais barato; "deepseek-v4-pro" fica melhor mas custa mais

export async function llmAvailable(): Promise<boolean> {
  const profile = await activeAiModel('text_generation')
  if (profile.provider === 'deepseek') return Boolean(process.env.DEEPSEEK_API_KEY)
  if (profile.provider === 'openai') return Boolean(process.env.OPENAI_API_KEY)
  return false
}

export class AiProviderError extends Error {
  constructor(message: string, public readonly durationMs: number, public readonly cause?: unknown, public readonly failureCode?: string) {
    super(message)
    this.name = 'AiProviderError'
  }
}

export type StructuredCompletion = {
  value: unknown
  provider: 'deepseek' | 'openai'
  model: string
  usage: AiUsage
  durationMs: number
  profile: ActiveAiModel
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
export async function generateStructuredCompletion(prompt: string, schema: object = GEMINI_RESPONSE_SCHEMA): Promise<StructuredCompletion> {
  const profile = await activeAiModel('text_generation')
  if (profile.provider !== 'deepseek' && profile.provider !== 'openai') {
    throw new AiProviderError('O perfil de texto ativo ainda não possui adaptador habilitado.', 0, undefined, 'provider_not_implemented')
  }
  const apiKey = profile.provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new AiProviderError(`${profile.provider === 'openai' ? 'OPENAI_API_KEY' : 'DEEPSEEK_API_KEY'} não configurado`, 0, undefined, 'provider_not_configured')
  const model = profile.model || (profile.provider === 'openai' ? 'gpt-4.1-mini' : DEFAULT_MODEL)
  const startedAt = Date.now()

  try {
    const request = profile.provider === 'openai'
      ? {
          url: `${OPENAI_BASE}/chat/completions`,
          body: {
            model,
            messages: [{ role: 'user', content: prompt + buildJsonInstruction(schema) }],
            response_format: { type: 'json_object' },
            max_tokens: 32768,
            temperature: 0.7,
          },
        }
      : {
          url: `${DEEPSEEK_BASE}/chat/completions`,
          body: {
            model,
            messages: [{ role: 'user', content: prompt + buildJsonInstruction(schema) }],
            response_format: { type: 'json_object' },
            thinking: { type: 'enabled' },
            max_tokens: 32768,
            temperature: 0.7,
          },
        }
    const { data } = await axios.post(
      request.url,
      request.body,
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 120000,
      },
    )

    const text = data?.choices?.[0]?.message?.content
    const finishReason = data?.choices?.[0]?.finish_reason
    const durationMs = Date.now() - startedAt
    if (!text) throw new AiProviderError('DeepSeek não retornou conteúdo (resposta vazia).', durationMs)
    if (finishReason === 'length') {
      throw new AiProviderError('DeepSeek cortou a resposta por limite de tokens (finish_reason=length).', durationMs)
    }

    try {
      return { value: JSON.parse(text), provider: profile.provider, model, usage: normalizeAiUsage(data?.usage), durationMs, profile }
    } catch {
      throw new AiProviderError(`${profile.provider === 'openai' ? 'OpenAI' : 'DeepSeek'} retornou JSON inválido.`, durationMs)
    }
  } catch (error) {
    if (error instanceof AiProviderError) throw error
    throw new AiProviderError('Falha ao chamar o provedor de IA.', Date.now() - startedAt, error)
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
      const failedProfile = profile ?? await activeAiModel('text_generation')
      await recordAiOperation({
        operation,
        provider: failedProfile.provider,
        model: failedProfile.model || (process.env.DEEPSEEK_MODEL || DEFAULT_MODEL),
        status: 'failed',
        attempt: 1,
        durationMs: error instanceof AiProviderError ? error.durationMs : null,
        errorCode: error instanceof AiBudgetExceededError ? AI_BUDGET_EXHAUSTED_CODE : 'provider_request_failed',
      })
    }
    throw error
  } finally {
    reservation?.release()
  }
}
