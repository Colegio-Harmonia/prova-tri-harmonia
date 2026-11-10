import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { administrativeAudit, aiModelProfiles, applicationSettings } from '@/db/schema'
import type { ActiveAiModel } from './modelProfiles'

export const TEXT_FALLBACK_SETTING = 'text_generation_fallback_profile_id'

export async function getTextFallbackModel(): Promise<ActiveAiModel | null> {
  const setting = await db.query.applicationSettings.findFirst({ where: eq(applicationSettings.key, TEXT_FALLBACK_SETTING) })
  const id = Number(setting?.value)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  const profile = await db.query.aiModelProfiles.findFirst({ where: eq(aiModelProfiles.id, id) })
  return profile?.purpose === 'text_generation' && ['deepseek', 'openai', 'gemini'].includes(profile.provider) ? profile : null
}

/** A reserva é uma escolha explícita da gestão; perfis inativos não viram fallback por conta própria. */
export async function saveTextFallbackModel(id: number | null, actorId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const previous = await tx.query.applicationSettings.findFirst({ where: eq(applicationSettings.key, TEXT_FALLBACK_SETTING) })
    const value = id === null ? '' : String(id)
    await tx.insert(applicationSettings).values({ key: TEXT_FALLBACK_SETTING, value, updatedBy: actorId })
      .onConflictDoUpdate({ target: applicationSettings.key, set: { value, updatedBy: actorId, updatedAt: new Date() } })
    await tx.insert(administrativeAudit).values({
      actorId, action: 'text_generation_fallback_updated',
      previousValue: { profileId: Number(previous?.value) || null },
      nextValue: { profileId: id },
    })
  })
}
