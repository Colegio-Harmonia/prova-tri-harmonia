import { and, desc, eq, gt } from 'drizzle-orm'
import { db } from '@/db/client'
import { jevDecisions } from '@/db/schema'

export type StoredJevDecision = {
  operation: string
  questionVersion: string
  model: string
  stateHash: string
  cacheKey: string
  source: 'provider' | 'cache' | 'fallback'
  status: 'succeeded' | 'failed'
  route: 'automatic' | 'review' | 'fallback'
  outcome: string
  context: Record<string, unknown> | null
  answers: Record<string, unknown> | null
  durationMs: number | null
  errorCode: string | null
  cacheExpiresAt: Date | null
}

export type JevDecisionStore = {
  findCached: (cacheKey: string, now: Date) => Promise<Pick<StoredJevDecision, 'model' | 'answers' | 'cacheExpiresAt'> | null>
  record: (decision: StoredJevDecision) => Promise<void>
}

export const databaseJevDecisionStore: JevDecisionStore = {
  async findCached(cacheKey, now) {
    const [row] = await db.select({ model: jevDecisions.model, answers: jevDecisions.answers, cacheExpiresAt: jevDecisions.cacheExpiresAt })
      .from(jevDecisions)
      .where(and(
        eq(jevDecisions.cacheKey, cacheKey),
        eq(jevDecisions.status, 'succeeded'),
        gt(jevDecisions.cacheExpiresAt, now),
      ))
      .orderBy(desc(jevDecisions.createdAt))
      .limit(1)
    return row?.answers && typeof row.answers === 'object'
      ? { model: row.model, answers: row.answers as Record<string, unknown>, cacheExpiresAt: row.cacheExpiresAt }
      : null
  },
  async record(decision) {
    await db.insert(jevDecisions).values(decision)
  },
}
