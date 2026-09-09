import { desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  CLASSIFICATION_AUDIT_ACTIONS,
  pedagogicalClassificationAudit,
} from '@/db/schema'

export type ClassificationAuditAction = (typeof CLASSIFICATION_AUDIT_ACTIONS)[number]
export type PedagogicalAuditEntry = typeof pedagogicalClassificationAudit.$inferSelect

type AuditWritable = Pick<typeof db, 'insert'>

export type RecordClassificationAuditParams = {
  classificationId: number
  action: ClassificationAuditAction
  previousValue?: unknown
  newValue?: unknown
  reason?: string | null
  performedBy?: number | null
}

export async function recordClassificationAudit(
  client: AuditWritable,
  params: RecordClassificationAuditParams,
): Promise<void> {
  await client.insert(pedagogicalClassificationAudit).values({
    classificationId: params.classificationId,
    action: params.action,
    previousValue: params.previousValue ?? null,
    newValue: params.newValue ?? null,
    reason: params.reason ?? null,
    performedBy: params.performedBy ?? null,
  })
}

export async function getClassificationAuditHistory(
  classificationId: number,
): Promise<PedagogicalAuditEntry[]> {
  return db.query.pedagogicalClassificationAudit.findMany({
    where: eq(pedagogicalClassificationAudit.classificationId, classificationId),
    orderBy: [desc(pedagogicalClassificationAudit.createdAt)],
  })
}
