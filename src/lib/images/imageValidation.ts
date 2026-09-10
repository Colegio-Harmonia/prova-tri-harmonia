import axios from 'axios'
import { AI_BUDGET_EXHAUSTED_CODE, AiBudgetExceededError, reserveAiOperation } from '@/lib/ai/operationBudget'
import { classifyAiFailure, normalizeAiUsage, recordAiOperation } from '@/lib/ai/operationTelemetry'
import { activeAiModel, estimateAiCostMicrousd } from '@/lib/ai/modelProfiles'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'

const geminiImageValidationSchema = {
  type: 'OBJECT',
  properties: {
    usable: { type: 'BOOLEAN' },
    layoutComplete: { type: 'BOOLEAN' },
    containsInstructionalText: { type: 'BOOLEAN' },
    textLegible: { type: 'BOOLEAN' },
    textMatchesExpected: { type: 'BOOLEAN' },
    reason: { type: 'STRING' },
  },
  required: ['usable', 'layoutComplete', 'containsInstructionalText', 'textLegible', 'textMatchesExpected', 'reason'],
} as const

type ImageValidation = {
  usable: boolean
  layoutComplete: boolean
  containsInstructionalText: boolean
  textLegible: boolean
  textMatchesExpected: boolean
  reason: string
}

/**
 * Alguns provedores preservam o JSON solicitado, mas o envolvem em um bloco
 * Markdown. Isso não muda o conteúdo do parecer e não deve transformar uma
 * imagem tecnicamente válida em falha operacional. Qualquer texto fora desse
 * formato continua sendo rejeitado pelo JSON.parse, para manter o fail-closed.
 */
export function parseImageValidationResponse(text: string): Partial<ImageValidation> {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
  return JSON.parse((fenced?.[1] ?? trimmed).trim()) as Partial<ImageValidation>
}

/**
 * Fails closed for AI illustrations: image models frequently hallucinate
 * worksheet text, incomplete panels and unreadable labels. A rejected asset
 * never reaches the teacher review queue.
 */
export async function validateGeneratedQuestionImage(params: {
  buffer: Buffer
  mimeType: string
  visualBrief: string
  questionContext: string
  expectedText?: string | null
}): Promise<ImageValidation> {
  const profile = await activeAiModel('image_validation')
  if (profile.provider !== 'gemini' && profile.provider !== 'anthropic') throw new Error('O perfil de validação de imagem ativo ainda não possui adaptador habilitado.')
  const apiKey = profile.provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error(`${profile.provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY'} não configurado para validar a imagem.`)
  const model = profile.model
  let reservation: Awaited<ReturnType<typeof reserveAiOperation>> | undefined
  const startedAt = Date.now()

  const prompt = `Você é o controle de qualidade de imagens de uma avaliação escolar. Avalie a imagem recebida antes de ela chegar ao professor.

Brief visual: "${params.visualBrief}"
Contexto da questão: "${params.questionContext.slice(0, 1200)}"
Texto exigido dentro da imagem: ${params.expectedText ? `"${params.expectedText}"` : '(nenhum)'}

Rejeite a imagem se houver painel, diagrama ou elemento essencial incompleto; texto ilegível, truncado ou com palavras inventadas; ou se ela não servir ao brief. Quando houver texto exigido, confirme se ele está completo e legível; quando não houver, qualquer instrução de prova dentro da imagem deve ser rejeitada. Responda somente JSON com usable, layoutComplete, containsInstructionalText, textLegible, textMatchesExpected e reason.`

  try {
    reservation = await reserveAiOperation('images/validate-generated-image')
    const { data } = profile.provider === 'anthropic'
      ? await axios.post(ANTHROPIC_MESSAGES_URL, {
          model,
          max_tokens: 1024,
          temperature: 0,
          messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: params.mimeType, data: params.buffer.toString('base64') } }, { type: 'text', text: prompt }] }],
        }, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 60_000 })
      : await axios.post(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
          contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: params.mimeType, data: params.buffer.toString('base64') } }] }],
          // responseMimeType sozinho não impede que modelos recentes emitam
          // aspas não escapadas em justificativas longas. O schema faz o
          // provedor garantir o contrato antes do parser fail-closed.
          generationConfig: { responseMimeType: 'application/json', responseSchema: geminiImageValidationSchema, temperature: 0 },
        }, { timeout: 60_000 })

    const text = profile.provider === 'anthropic'
      ? data?.content?.find((part: { type?: string; text?: string }) => part.type === 'text')?.text
      : data?.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => part.text)?.text
    if (!text) throw new Error('Validador visual não retornou avaliação.')
    const parsed = parseImageValidationResponse(text)
    if (typeof parsed.usable !== 'boolean' || typeof parsed.layoutComplete !== 'boolean' || typeof parsed.containsInstructionalText !== 'boolean' || typeof parsed.textLegible !== 'boolean' || typeof parsed.textMatchesExpected !== 'boolean') {
      throw new Error('Validador visual retornou formato inválido.')
    }
    const usage = profile.provider === 'anthropic' ? normalizeAiUsage({ prompt_tokens: data?.usage?.input_tokens, completion_tokens: data?.usage?.output_tokens, total_tokens: (data?.usage?.input_tokens ?? 0) + (data?.usage?.output_tokens ?? 0) }) : undefined
    await recordAiOperation({ operation: 'images/validate-generated-image', provider: profile.provider, model, status: 'succeeded', attempt: 1, durationMs: Date.now() - startedAt, usage, modelProfileId: profile.id, estimatedCostMicrousd: estimateAiCostMicrousd({ model: profile, promptTokens: usage?.promptTokens, completionTokens: usage?.completionTokens }) })
    return {
      usable: parsed.usable,
      layoutComplete: parsed.layoutComplete,
      containsInstructionalText: parsed.containsInstructionalText,
      textLegible: parsed.textLegible,
      textMatchesExpected: parsed.textMatchesExpected,
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'Sem justificativa.',
    }
  } catch (error) {
    await recordAiOperation({
      operation: 'images/validate-generated-image',
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
