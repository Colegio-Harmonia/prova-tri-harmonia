// Histórico de decisões pedagógicas (Bloco 8). Registro append-only de quem
// decidiu o quê no planejamento e nas intervenções, para auditoria.

import { desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { pedagogicalDecisionLog, users } from '@/db/schema'

type Executor = Pick<typeof db, 'insert'>

export type DecisionEntry = {
  entityType: 'plano' | 'versao' | 'intervencao'
  entityId: number
  planId?: number | null
  action: string
  summary: string
  details?: Record<string, unknown> | null
  actorId: number
}

export async function recordDecision(executor: Executor, entry: DecisionEntry) {
  await executor.insert(pedagogicalDecisionLog).values({ ...entry, planId: entry.planId ?? null, details: entry.details ?? null })
}

export async function planDecisions(planId: number, limit = 100) {
  return db.select({
    id: pedagogicalDecisionLog.id, entityType: pedagogicalDecisionLog.entityType, entityId: pedagogicalDecisionLog.entityId,
    action: pedagogicalDecisionLog.action, summary: pedagogicalDecisionLog.summary, details: pedagogicalDecisionLog.details,
    createdAt: pedagogicalDecisionLog.createdAt, actor: users.name,
  }).from(pedagogicalDecisionLog).innerJoin(users, eq(users.id, pedagogicalDecisionLog.actorId))
    .where(eq(pedagogicalDecisionLog.planId, planId)).orderBy(desc(pedagogicalDecisionLog.createdAt)).limit(limit)
}

/** Diferença de habilidades entre duas versões do conteúdo, para o histórico. */
export function skillDiff(before: string[], after: string[]) {
  const a = new Set(before)
  const b = new Set(after)
  return { added: [...b].filter((code) => !a.has(code)).sort(), removed: [...a].filter((code) => !b.has(code)).sort() }
}
