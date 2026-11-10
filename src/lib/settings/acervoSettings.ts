import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { administrativeAudit, applicationSettings } from '@/db/schema'
import { acervoUrlSchema, DEFAULT_ACERVO_API_URL } from './acervoUrl'

const KEY = 'acervo_api_url'

export async function getAcervoApiUrl(): Promise<string> {
  const setting = await db.query.applicationSettings.findFirst({ where: eq(applicationSettings.key, KEY) })
  return setting?.value || process.env.ACERVO_API_URL?.trim() || DEFAULT_ACERVO_API_URL
}

export async function saveAcervoApiUrl(input: string, actorId: number): Promise<string> {
  const value = acervoUrlSchema.parse(input)
  await db.transaction(async (tx) => {
    const previous = await tx.query.applicationSettings.findFirst({ where: eq(applicationSettings.key, KEY) })
    await tx.insert(applicationSettings).values({ key: KEY, value, updatedBy: actorId })
      .onConflictDoUpdate({ target: applicationSettings.key, set: { value, updatedBy: actorId, updatedAt: new Date() } })
    await tx.insert(administrativeAudit).values({
      actorId, action: 'acervo_api_url_updated',
      previousValue: { url: previous?.value || process.env.ACERVO_API_URL?.trim() || DEFAULT_ACERVO_API_URL },
      nextValue: { url: value },
    })
  })
  return value
}
