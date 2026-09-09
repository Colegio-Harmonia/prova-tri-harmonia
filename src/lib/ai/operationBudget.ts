import { and, gte, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { aiOperations } from '@/db/schema'

export const AI_BUDGET_EXHAUSTED_CODE = 'daily_operation_budget_exhausted'
export const DEFAULT_AI_DAILY_OPERATION_BUDGET = 50

export class AiBudgetExceededError extends Error {
  constructor(public readonly dailyLimit: number) {
    super('O limite diário de operações de IA foi atingido.')
    this.name = 'AiBudgetExceededError'
  }
}

type AiOperationReservation = {
  release: () => void
}

const activeReservations = new Map<string, number>()

export function parseAiDailyOperationBudget(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_AI_DAILY_OPERATION_BUDGET
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return DEFAULT_AI_DAILY_OPERATION_BUDGET
  return parsed
}

export function isAiOperationBudgetExhausted(params: { completed: number; pending: number; limit: number }): boolean {
  return params.limit > 0 && params.completed + params.pending >= params.limit
}

function utcWindow(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { key: start.toISOString().slice(0, 10), start, end }
}

/**
 * Reserva uma chamada antes de contatar o provedor. O contador persistido
 * cobre reinícios; a reserva em memória evita que requisições concorrentes
 * ultrapassem o limite no mesmo processo. Valor 0 desativa o teto somente de
 * forma explícita por variável de ambiente.
 */
export async function reserveAiOperation(now = new Date()): Promise<AiOperationReservation> {
  const limit = parseAiDailyOperationBudget(process.env.AI_DAILY_OPERATION_BUDGET)
  if (limit === 0) return { release: () => undefined }

  const { key, start, end } = utcWindow(now)
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiOperations)
    .where(and(
      gte(aiOperations.createdAt, start),
      lt(aiOperations.createdAt, end),
      or(isNull(aiOperations.errorCode), ne(aiOperations.errorCode, AI_BUDGET_EXHAUSTED_CODE)),
    ))

  const pending = activeReservations.get(key) ?? 0
  if (isAiOperationBudgetExhausted({ completed: Number(row?.count ?? 0), pending, limit })) {
    throw new AiBudgetExceededError(limit)
  }

  activeReservations.set(key, pending + 1)
  let released = false
  return {
    release: () => {
      if (released) return
      released = true
      const current = activeReservations.get(key) ?? 0
      if (current <= 1) activeReservations.delete(key)
      else activeReservations.set(key, current - 1)
    },
  }
}
