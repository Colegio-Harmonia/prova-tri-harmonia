import axios from 'axios'
import { AI_BUDGET_EXHAUSTED_CODE, AiBudgetExceededError, reserveAiOperation } from '@/lib/ai/operationBudget'
import { classifyAiFailure, recordAiOperation } from '@/lib/ai/operationTelemetry'
import { activeAiModel, estimateAiCostMicrousd } from '@/lib/ai/modelProfiles'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations'

export type GeneratedImage = { mimeType: string; base64: string }

export function openAiImageGenerationPayload(model: string, prompt: string) {
  // GPT Image retorna b64_json por padrão, mas rejeita o parâmetro legado
  // response_format (aceito apenas pelos modelos DALL·E). Manter esse campo
  // em GPT Image transformava toda imagem obrigatória em erro 400.
  return {
    model,
    prompt,
    size: '1024x1024',
    ...(model.startsWith('dall-e-') ? { response_format: 'b64_json' } : {}),
  }
}

/**
 * Fallback when Wikimedia Commons has no usable result. The active image
 * profile selects Gemini or DALL-E; keys remain server-side.
 */
export async function generateIllustration(query: string, context: string, expectedText?: string): Promise<GeneratedImage> {
  let reservation: Awaited<ReturnType<typeof reserveAiOperation>> | undefined
  const startedAt = Date.now()
  const profile = await activeAiModel('image_generation')
  if (profile.provider !== 'gemini' && profile.provider !== 'openai') throw new Error('O perfil de imagem ativo ainda não possui adaptador habilitado.')
  if (expectedText && profile.provider !== 'openai') throw new Error('Para gerar imagem com texto, ative um perfil DALL-E/OpenAI no painel de IA.')
  const apiKey = profile.provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error(`${profile.provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} não configurado`)
  const model = profile.model

  const prompt = `Crie SOMENTE o recurso visual didático para uma prova escolar sobre: "${query}". ` +
    `Contexto pedagógico (não renderize este texto): ${context}. Estilo: diagrama educacional claro, cores simples e adequado para impressão em preto e branco. ` +
    (expectedText
      ? ` Inclua EXATAMENTE este texto, sem alterar acentos, letras ou pontuação: "${expectedText}". Não inclua nenhum outro texto.`
      : ' NÃO crie folha de atividade. NÃO inclua enunciado, instruções, títulos, letras, números, legendas, balões de fala ou qualquer texto. A instrução e qualquer texto verificável serão exibidos fora da imagem pela aplicação.')

  try {
    reservation = await reserveAiOperation('images/generate-illustration')
    if (profile.provider === 'openai') {
      const { data } = await axios.post(OPENAI_IMAGES_URL, openAiImageGenerationPayload(model, prompt), {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 120_000,
      })
      const base64 = data?.data?.[0]?.b64_json
      if (typeof base64 !== 'string' || !base64) throw new Error('OpenAI não retornou uma imagem válida.')
      await recordAiOperation({ operation: 'images/generate-illustration', provider: 'openai', model, status: 'succeeded', attempt: 1, durationMs: Date.now() - startedAt, modelProfileId: profile.id, estimatedCostMicrousd: estimateAiCostMicrousd({ model: profile }) })
      return { mimeType: 'image/png', base64 }
    }

    const { data } = await axios.post(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
      contents: [{ parts: [{ text: prompt }] }],
    }, { timeout: 120_000 })
    const parts = data?.candidates?.[0]?.content?.parts ?? []
    const imagePart = parts.find((part: { inlineData?: { mimeType: string; data: string } }) => part.inlineData)
    if (!imagePart?.inlineData) throw new Error('Gemini não retornou uma imagem (resposta sem inlineData).')
    await recordAiOperation({ operation: 'images/generate-illustration', provider: 'gemini', model, status: 'succeeded', attempt: 1, durationMs: Date.now() - startedAt, modelProfileId: profile.id, estimatedCostMicrousd: estimateAiCostMicrousd({ model: profile }) })
    return { mimeType: imagePart.inlineData.mimeType, base64: imagePart.inlineData.data }
  } catch (error) {
    await recordAiOperation({
      operation: 'images/generate-illustration',
      provider: profile.provider,
      model,
      status: 'failed',
      attempt: 1,
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof AiBudgetExceededError ? AI_BUDGET_EXHAUSTED_CODE : classifyAiFailure(error),
    })
    throw error
  } finally {
    reservation?.release()
  }
}
