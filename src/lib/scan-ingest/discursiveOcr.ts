import axios from 'axios'
import sharp from 'sharp'
import { z } from 'zod'
import { AI_BUDGET_EXHAUSTED_CODE, AiBudgetExceededError, reserveAiOperation } from '@/lib/ai/operationBudget'
import { classifyAiFailure, normalizeAiUsage, recordAiOperation } from '@/lib/ai/operationTelemetry'
import { activeAiModel, estimateAiCostMicrousd } from '@/lib/ai/modelProfiles'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const CANONICAL_WIDTH = 2100
const CANONICAL_HEIGHT = 2970
const PX_PER_MM = CANONICAL_WIDTH / 210

export class DiscursiveOcrError extends Error {
  constructor(message: string, public readonly failureCode: string) {
    super(message)
    this.name = 'DiscursiveOcrError'
  }
}

export type DiscursiveCropGeometry = { left: number; top: number; width: number; height: number }

/**
 * PTR1 reserva 147 mm para até três respostas discursivas. O recorte exclui
 * o rótulo da questão e as margens, preservando somente a área manuscrita.
 */
export function discursiveCropGeometry(questionIndex: number, questionsOnPage: number, pageSize?: { width: number; height: number }): DiscursiveCropGeometry {
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= questionsOnPage) throw new Error('Índice de questão discursiva inválido.')
  if (!Number.isInteger(questionsOnPage) || questionsOnPage < 1 || questionsOnPage > 3) throw new Error('Quantidade de questões discursivas inválida.')

  const mm = (value: number) => Math.round(value * PX_PER_MM)
  const gap = mm(7)
  const boxTop = mm(100) + questionIndex * ((mm(147) - gap * (questionsOnPage - 1)) / questionsOnPage + gap)
  const boxHeight = (mm(147) - gap * (questionsOnPage - 1)) / questionsOnPage
  const canonicalGeometry = {
    left: mm(16),
    top: Math.round(boxTop + mm(11)),
    width: CANONICAL_WIDTH - mm(32),
    height: Math.round(boxHeight - mm(17)),
  }
  if (!pageSize) return canonicalGeometry
  if (!Number.isInteger(pageSize.width) || !Number.isInteger(pageSize.height) || pageSize.width < 1 || pageSize.height < 1) {
    throw new DiscursiveOcrError('Imagem sem dimensões válidas para recorte.', 'invalid_image_dimensions')
  }
  const scaleX = pageSize.width / CANONICAL_WIDTH
  const scaleY = pageSize.height / CANONICAL_HEIGHT
  const left = Math.max(0, Math.floor(canonicalGeometry.left * scaleX))
  const top = Math.max(0, Math.floor(canonicalGeometry.top * scaleY))
  const width = Math.min(pageSize.width - left, Math.max(1, Math.ceil(canonicalGeometry.width * scaleX)))
  const height = Math.min(pageSize.height - top, Math.max(1, Math.ceil(canonicalGeometry.height * scaleY)))
  return { left, top, width, height }
}

export async function cropDiscursiveAnswer(params: { canonicalImage: Buffer; questionIndex: number; questionsOnPage: number }) {
  const image = sharp(params.canonicalImage, { failOn: 'error' })
  const metadata = await image.metadata()
  if (!metadata.width || !metadata.height) throw new DiscursiveOcrError('Não foi possível identificar o tamanho da imagem.', 'invalid_image_dimensions')
  const geometry = discursiveCropGeometry(params.questionIndex, params.questionsOnPage, { width: metadata.width, height: metadata.height })
  return image
    .extract(geometry)
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer()
}

const ocrResponseSchema = z.object({
  transcription: z.string().max(20_000),
  confidence: z.number().min(0).max(1),
  legible: z.boolean(),
  // Diferencia uma área sem escrita de uma resposta escrita que não pôde ser
  // lida. Opcional para aceitar respostas antigas do modelo.
  blank: z.boolean().optional(),
}).strict()

const ocrBatchResponseSchema = z.object({
  answers: z.array(ocrResponseSchema.extend({ questionNumber: z.number().int().positive() })).max(20),
}).strict()

export type DiscursiveOcrResult = z.infer<typeof ocrResponseSchema> & { provider: string; model: string }

/** Normaliza o resultado do provedor para que todos os caminhos (lote,
 * individual e OCR solicitado pelo professor) tratem uma folha vazia igual.
 * Modelos antigos que não conhecem `blank` ainda são reconhecidos quando
 * retornam resposta legível sem texto.
 */
export function classifyDiscursiveOcrResult(result: Pick<DiscursiveOcrResult, 'blank' | 'legible' | 'transcription'>) {
  const transcription = result.transcription.trim()
  const blank = result.blank === true || (result.blank === undefined && result.legible && !transcription)
  return { blank, legible: !blank && result.legible && Boolean(transcription) }
}

function transcriptionPrompt() {
  return `Você está transcrevendo exclusivamente uma resposta manuscrita de aluno em português brasileiro.\n\nTranscreva apenas o que o aluno escreveu no recorte da área de resposta. Não complete lacunas, não corrija ortografia, não parafraseie, não explique, não avalie e não atribua nota. Ignore linhas, rótulos impressos e qualquer texto do formulário.\n\nSe não houver nenhuma escrita ou marca de resposta no recorte, retorne transcription como string vazia, legible como true e blank como true. Se houver escrita, mas não for possível lê-la com segurança, retorne transcription como string vazia, legible como false e blank como false.\n\nResponda somente JSON válido: {"transcription":"texto literal", "confidence":0.0, "legible":true, "blank":false}.`
}

function batchTranscriptionPrompt(questionNumbers: number[]) {
  return `Você está transcrevendo respostas manuscritas de alunos em português brasileiro. Receberá ${questionNumbers.length} imagens, uma para cada questão, nesta ordem: ${questionNumbers.map((number, index) => `imagem ${index + 1} = questão ${number}`).join('; ')}.

Para cada imagem, transcreva exclusivamente o que o aluno escreveu na área de resposta. Não complete lacunas, não corrija ortografia, não parafraseie, não explique, não avalie e não atribua nota. Ignore linhas, rótulos impressos e qualquer texto do formulário. Se não houver escrita ou marca de resposta, use transcription como string vazia, legible como true e blank como true. Se houver escrita, mas ela estiver ilegível, use transcription como string vazia, legible como false e blank como false.

Responda somente JSON válido neste formato: {"answers":[{"questionNumber":${questionNumbers[0] ?? 1},"transcription":"texto literal","confidence":0.0,"legible":true,"blank":false}]}. Deve haver exatamente uma entrada para cada questão recebida, usando o número correto da questão.`
}

function cleanJsonText(raw: string): string {
  const trimmed = raw.trim()
  const codeBlockMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return codeBlockMatch ? codeBlockMatch[1].trim() : trimmed
}

function parseProviderResponse(provider: 'gemini' | 'anthropic', data: unknown) {
  const body = data as { content?: Array<{ type?: string; text?: string }>; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const text = provider === 'anthropic'
    ? body.content?.find((part) => part.type === 'text')?.text
    : body.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text
  if (!text) throw new DiscursiveOcrError('O provedor não retornou uma transcrição.', 'provider_empty_response')
  try {
    return ocrResponseSchema.parse(JSON.parse(cleanJsonText(text)))
  } catch {
    throw new DiscursiveOcrError('O provedor retornou uma transcrição em formato inválido.', 'provider_invalid_response')
  }
}

export function discursiveProviderFailure(error: unknown, model: string) {
  if (!axios.isAxiosError(error)) return null
  const status = error.response?.status
  if (status === 404) return new DiscursiveOcrError(`O modelo de leitura ${model} não está disponível para esta conta. Atualize o perfil de Leitura de respostas.`, 'provider_model_not_available')
  if (status === 402) return new DiscursiveOcrError('Os créditos do provedor de IA estão esgotados. Recarregue a conta no AI Studio.', 'provider_credits_exhausted')
  if (status === 400) return new DiscursiveOcrError('O provedor recusou o formato da leitura. A configuração do modelo precisa ser atualizada.', 'provider_invalid_request')
  if (status === 401 || status === 403) return new DiscursiveOcrError('O provedor recusou a credencial de leitura. Confira a configuração da integração.', 'provider_auth')
  if (status === 429) return new DiscursiveOcrError('O provedor atingiu o limite temporário de leitura. Tente novamente em alguns instantes.', 'rate_limited')
  if (status && status >= 500) return new DiscursiveOcrError('O provedor de leitura está indisponível no momento. Tente novamente mais tarde.', 'provider_unavailable')
  return new DiscursiveOcrError('Não foi possível enviar a leitura ao provedor.', 'provider_request_failed')
}

/**
 * A chamada recebe só o recorte da questão, nunca a URL do Drive nem a página
 * inteira. O resultado é uma sugestão, não atualiza a correção formal.
 */
export async function transcribeDiscursiveAnswer(params: { image: Buffer; mimeType: 'image/jpeg' | 'image/png' }) {
  const profile = await activeAiModel('scan_transcription')
  if (profile.provider !== 'gemini' && profile.provider !== 'anthropic') {
    throw new DiscursiveOcrError('O perfil de leitura de respostas não possui um provedor visual habilitado.', 'provider_not_implemented')
  }
  const apiKey = profile.provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new DiscursiveOcrError('O provedor de OCR não está configurado neste ambiente.', 'provider_not_configured')

  let reservation: Awaited<ReturnType<typeof reserveAiOperation>> | undefined
  const startedAt = Date.now()
  try {
    reservation = await reserveAiOperation('scans/transcribe-discursive')
    const data = profile.provider === 'anthropic'
      ? (await axios.post(ANTHROPIC_MESSAGES_URL, {
          model: profile.model,
          max_tokens: 8_000,
          temperature: 0,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: params.mimeType, data: params.image.toString('base64') } },
            { type: 'text', text: transcriptionPrompt() },
          ] }],
        }, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 90_000 })).data
      : (await axios.post(`${GEMINI_BASE}/${profile.model}:generateContent?key=${apiKey}`, {
          contents: [{ parts: [{ inlineData: { mimeType: params.mimeType, data: params.image.toString('base64') } }, { text: transcriptionPrompt() }] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8_000 },
        }, { timeout: 90_000 })).data
    const transcription = parseProviderResponse(profile.provider, data)
    const usage = profile.provider === 'anthropic'
      ? normalizeAiUsage((data as { usage?: unknown }).usage)
      : profile.provider === 'gemini'
        ? normalizeAiUsage({
            prompt_tokens: (data as { usageMetadata?: { promptTokenCount?: number } })?.usageMetadata?.promptTokenCount,
            completion_tokens: (data as { usageMetadata?: { candidatesTokenCount?: number } })?.usageMetadata?.candidatesTokenCount,
            total_tokens: (data as { usageMetadata?: { totalTokenCount?: number } })?.usageMetadata?.totalTokenCount,
          })
        : undefined
    await recordAiOperation({ operation: 'scans/transcribe-discursive', provider: profile.provider, model: profile.model, status: 'succeeded', attempt: 1, durationMs: Date.now() - startedAt, usage, modelProfileId: profile.id, estimatedCostMicrousd: estimateAiCostMicrousd({ model: profile, promptTokens: usage?.promptTokens, completionTokens: usage?.completionTokens }) })
    return { ...transcription, provider: profile.provider, model: profile.model }
  } catch (error) {
    const normalized = discursiveProviderFailure(error, profile.model) ?? error
    await recordAiOperation({
      operation: 'scans/transcribe-discursive', provider: profile.provider, model: profile.model, status: 'failed', attempt: 1,
      durationMs: Date.now() - startedAt,
      errorCode: normalized instanceof DiscursiveOcrError ? normalized.failureCode : normalized instanceof AiBudgetExceededError ? AI_BUDGET_EXHAUSTED_CODE : classifyAiFailure(normalized),
      modelProfileId: profile.id,
    })
    if (normalized instanceof DiscursiveOcrError || normalized instanceof AiBudgetExceededError) throw normalized
    throw new DiscursiveOcrError('Não foi possível concluir a leitura automática desta resposta.', classifyAiFailure(normalized))
  } finally {
    reservation?.release()
  }
}

/** Lê todos os recortes discursivos de uma mesma folha em uma única chamada.
 * O contrato devolve uma entrada por questão, mantendo a persistência e a
 * revisão independentes no banco. */
export async function transcribeDiscursiveAnswers(params: { answers: Array<{ questionNumber: number; image: Buffer; mimeType: 'image/jpeg' | 'image/png' }> }): Promise<{ answers: Array<z.infer<typeof ocrResponseSchema> & { questionNumber: number }>; provider: string; model: string }> {
  if (!params.answers.length) return { answers: [], provider: 'none', model: 'none' }
  const profile = await activeAiModel('scan_transcription')
  if (profile.provider !== 'gemini' && profile.provider !== 'anthropic') {
    throw new DiscursiveOcrError('O perfil de leitura de respostas não possui um provedor visual habilitado.', 'provider_not_implemented')
  }
  const apiKey = profile.provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new DiscursiveOcrError('O provedor de OCR não está configurado neste ambiente.', 'provider_not_configured')

  let reservation: Awaited<ReturnType<typeof reserveAiOperation>> | undefined
  const startedAt = Date.now()
  const questionNumbers = params.answers.map((answer) => answer.questionNumber)
  try {
    reservation = await reserveAiOperation('scans/transcribe-discursive-batch')
    const prompt = batchTranscriptionPrompt(questionNumbers)
    const data = profile.provider === 'anthropic'
      ? (await axios.post(ANTHROPIC_MESSAGES_URL, {
          model: profile.model,
          max_tokens: 8_000,
          temperature: 0,
          messages: [{ role: 'user', content: [
            ...params.answers.flatMap((answer) => [{ type: 'image', source: { type: 'base64', media_type: answer.mimeType, data: answer.image.toString('base64') } }, { type: 'text', text: `A imagem seguinte corresponde à questão ${answer.questionNumber}.` }]),
            { type: 'text', text: prompt },
          ] }],
        }, { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 90_000 })).data
      : (await axios.post(`${GEMINI_BASE}/${profile.model}:generateContent?key=${apiKey}`, {
          contents: [{ parts: [
            ...params.answers.flatMap((answer) => [{ inlineData: { mimeType: answer.mimeType, data: answer.image.toString('base64') } }, { text: `Esta imagem corresponde à questão ${answer.questionNumber}.` }]),
            { text: prompt },
          ] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8_000 },
        }, { timeout: 90_000 })).data
    const body = data as { content?: Array<{ type?: string; text?: string }>; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const text = profile.provider === 'anthropic'
      ? body.content?.find((part) => part.type === 'text')?.text
      : body.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text
    if (!text) throw new DiscursiveOcrError('O provedor não retornou transcrições.', 'provider_empty_response')
    let parsed: z.infer<typeof ocrBatchResponseSchema>
    try {
      parsed = ocrBatchResponseSchema.parse(JSON.parse(cleanJsonText(text)))
    } catch {
      throw new DiscursiveOcrError('O provedor retornou transcrições em formato inválido.', 'provider_invalid_response')
    }
    const usage = profile.provider === 'anthropic'
      ? normalizeAiUsage((data as { usage?: unknown }).usage)
      : profile.provider === 'gemini'
        ? normalizeAiUsage({
            prompt_tokens: (data as { usageMetadata?: { promptTokenCount?: number } })?.usageMetadata?.promptTokenCount,
            completion_tokens: (data as { usageMetadata?: { candidatesTokenCount?: number } })?.usageMetadata?.candidatesTokenCount,
            total_tokens: (data as { usageMetadata?: { totalTokenCount?: number } })?.usageMetadata?.totalTokenCount,
          })
        : undefined
    await recordAiOperation({ operation: 'scans/transcribe-discursive-batch', provider: profile.provider, model: profile.model, status: 'succeeded', attempt: 1, durationMs: Date.now() - startedAt, usage, modelProfileId: profile.id, estimatedCostMicrousd: estimateAiCostMicrousd({ model: profile, promptTokens: usage?.promptTokens, completionTokens: usage?.completionTokens }) })
    return { answers: parsed.answers, provider: profile.provider, model: profile.model }
  } catch (error) {
    const normalized = discursiveProviderFailure(error, profile.model) ?? error
    await recordAiOperation({
      operation: 'scans/transcribe-discursive-batch', provider: profile.provider, model: profile.model, status: 'failed', attempt: 1,
      durationMs: Date.now() - startedAt,
      errorCode: normalized instanceof DiscursiveOcrError ? normalized.failureCode : normalized instanceof AiBudgetExceededError ? AI_BUDGET_EXHAUSTED_CODE : classifyAiFailure(normalized),
      modelProfileId: profile.id,
    })
    if (normalized instanceof DiscursiveOcrError || normalized instanceof AiBudgetExceededError) throw normalized
    throw new DiscursiveOcrError('Não foi possível concluir a leitura automática das respostas.', classifyAiFailure(normalized))
  } finally {
    reservation?.release()
  }
}
