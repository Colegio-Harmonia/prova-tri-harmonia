import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { aiModelProfiles } from '@/db/schema'

export type AiPurpose = 'text_generation' | 'image_generation' | 'image_validation' | 'scan_transcription'

export type ActiveAiModel = {
  id: number | null
  provider: 'deepseek' | 'gemini' | 'anthropic' | 'openai'
  model: string
  inputCostMicrousdPerMillion: number | null
  outputCostMicrousdPerMillion: number | null
  imageCostMicrousd: number | null
}

const fallbacks: Record<AiPurpose, ActiveAiModel> = {
  text_generation: { id: null, provider: 'deepseek', model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash', inputCostMicrousdPerMillion: null, outputCostMicrousdPerMillion: null, imageCostMicrousd: null },
  image_generation: { id: null, provider: 'gemini', model: process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image', inputCostMicrousdPerMillion: null, outputCostMicrousdPerMillion: null, imageCostMicrousd: null },
  image_validation: { id: null, provider: 'gemini', model: process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash', inputCostMicrousdPerMillion: null, outputCostMicrousdPerMillion: null, imageCostMicrousd: null },
  // OCR manuscrito é uma finalidade própria: a gestão pode escolher e pausar
  // seu modelo sem afetar a validação visual de ilustrações.
  scan_transcription: { id: null, provider: 'gemini', model: process.env.GEMINI_SCAN_TRANSCRIPTION_MODEL || 'gemini-3.5-flash-lite', inputCostMicrousdPerMillion: null, outputCostMicrousdPerMillion: null, imageCostMicrousd: null },
}

export async function activeAiModel(purpose: AiPurpose): Promise<ActiveAiModel> {
  try {
    const profile = await db.query.aiModelProfiles.findFirst({ where: and(eq(aiModelProfiles.purpose, purpose), eq(aiModelProfiles.enabled, true)) })
    if (!profile) return fallbacks[purpose]
    return profile
  } catch {
    return fallbacks[purpose]
  }
}

export function estimateAiCostMicrousd(params: { model: ActiveAiModel; promptTokens?: number | null; completionTokens?: number | null }): number | null {
  const { model, promptTokens = 0, completionTokens = 0 } = params
  if (model.imageCostMicrousd !== null) return model.imageCostMicrousd
  if (model.inputCostMicrousdPerMillion === null || model.outputCostMicrousdPerMillion === null) return null
  return Math.round(((promptTokens ?? 0) * model.inputCostMicrousdPerMillion + (completionTokens ?? 0) * model.outputCostMicrousdPerMillion) / 1_000_000)
}
