import { and, desc, eq, gte, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { aiBudgetResets, aiOperations } from '@/db/schema'

export const AI_BUDGET_EXHAUSTED_CODE = 'daily_operation_budget_exhausted'
export const DEFAULT_AI_DAILY_OPERATION_BUDGET = 50
export type AiBudgetPurpose = 'text_generation' | 'image_generation' | 'image_validation' | 'scan_transcription'

export class AiBudgetExceededError extends Error {
  constructor(public readonly dailyLimit: number, public readonly purpose: AiBudgetPurpose) {
    super(`O limite diário de ${budgetPurposeLabel(purpose)} foi atingido.`)
    this.name = 'AiBudgetExceededError'
  }
}

type AiOperationReservation = {
  release: () => void
}

const activeReservations = new Map<string, number>()

const PURPOSE_ENV: Record<AiBudgetPurpose, string> = {
  text_generation: 'AI_DAILY_OPERATION_BUDGET_TEXT_GENERATION',
  image_generation: 'AI_DAILY_OPERATION_BUDGET_IMAGE_GENERATION',
  image_validation: 'AI_DAILY_OPERATION_BUDGET_IMAGE_VALIDATION',
  scan_transcription: 'AI_DAILY_OPERATION_BUDGET_SCAN_TRANSCRIPTION',
}

export function budgetPurposeLabel(purpose: AiBudgetPurpose) {
  return ({ text_generation: 'geração de texto', image_generation: 'geração de imagens', image_validation: 'validação de imagens', scan_transcription: 'leitura de respostas' } as const)[purpose]
}

/** A telemetria já carrega a operação; ela define a cota isolada aplicável. */
export function budgetPurposeForOperation(operation: string): AiBudgetPurpose {
  if (operation.startsWith('scans/')) return 'scan_transcription'
  if (operation.startsWith('images/validate')) return 'image_validation'
  if (operation.startsWith('images/')) return 'image_generation'
  return 'text_generation'
}

export function parseAiDailyOperationBudget(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_AI_DAILY_OPERATION_BUDGET
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return DEFAULT_AI_DAILY_OPERATION_BUDGET
  return parsed
}

export function isAiOperationBudgetExhausted(params: { completed: number; pending: number; limit: number }): boolean {
  return params.limit > 0 && params.completed + params.pending >= params.limit
}

function saoPauloWindow(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '01'
  // São Paulo não adota horário de verão desde 2019; o offset fixo preserva
  // o dia pedagógico esperado pela escola em vez de resetar à meia-noite UTC.
  const start = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00-03:00`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { key: `${part('year')}-${part('month')}-${part('day')}`, start, end }
}

export function nextAiBudgetWindowStart(now = new Date()) {
  return saoPauloWindow(now).end
}

export const AI_BUDGET_PURPOSES: AiBudgetPurpose[] = ['text_generation', 'image_generation', 'image_validation', 'scan_transcription']

export function aiBudgetLimit(purpose: AiBudgetPurpose) {
  return parseAiDailyOperationBudget(process.env[PURPOSE_ENV[purpose]] ?? process.env.AI_DAILY_OPERATION_BUDGET)
}

async function budgetResetStart(purpose: AiBudgetPurpose, start: Date) {
  const reset = await db.query.aiBudgetResets.findFirst({
    where: and(gte(aiBudgetResets.createdAt, start), or(isNull(aiBudgetResets.purpose), eq(aiBudgetResets.purpose, purpose))),
    orderBy: [desc(aiBudgetResets.createdAt)],
  })
  return reset?.createdAt && reset.createdAt > start ? reset.createdAt : start
}

export async function getAiBudgetSnapshot(now = new Date()) {
  const { start, end } = saoPauloWindow(now)
  return Promise.all(AI_BUDGET_PURPOSES.map(async (purpose) => {
    const usedSince = await budgetResetStart(purpose, start)
    const operationScope = purpose === 'text_generation'
      ? sql`${aiOperations.operation} NOT LIKE 'images/%' AND ${aiOperations.operation} NOT LIKE 'scans/%'`
      : purpose === 'image_generation'
        ? sql`${aiOperations.operation} LIKE 'images/%' AND ${aiOperations.operation} NOT LIKE 'images/validate%'`
        : purpose === 'image_validation'
          ? sql`${aiOperations.operation} LIKE 'images/validate%'`
          : sql`${aiOperations.operation} LIKE 'scans/%'`
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(aiOperations).where(and(
      gte(aiOperations.createdAt, usedSince), lt(aiOperations.createdAt, end),
      or(isNull(aiOperations.errorCode), ne(aiOperations.errorCode, AI_BUDGET_EXHAUSTED_CODE)), operationScope,
    ))
    return { purpose, limit: aiBudgetLimit(purpose), used: Number(row?.count ?? 0), resetAt: usedSince, nextResetAt: end }
  }))
}

/**
 * Reserva uma chamada antes de contatar o provedor. O contador persistido
 * cobre reinícios; a reserva em memória evita que requisições concorrentes
 * ultrapassem o limite no mesmo processo. Valor 0 desativa o teto somente de
 * forma explícita por variável de ambiente.
 */
export async function reserveAiOperation(operation = 'text_generation', now = new Date()): Promise<AiOperationReservation> {
  const purpose = budgetPurposeForOperation(operation)
  const limit = aiBudgetLimit(purpose)
  if (limit === 0) return { release: () => undefined }

  const { key: dayKey, start, end } = saoPauloWindow(now)
  const key = `${purpose}:${dayKey}`
  const operationScope = purpose === 'text_generation'
    ? sql`${aiOperations.operation} NOT LIKE 'images/%' AND ${aiOperations.operation} NOT LIKE 'scans/%'`
    : purpose === 'image_generation'
      ? sql`${aiOperations.operation} LIKE 'images/%' AND ${aiOperations.operation} NOT LIKE 'images/validate%'`
      : purpose === 'image_validation'
        ? sql`${aiOperations.operation} LIKE 'images/validate%'`
        : sql`${aiOperations.operation} LIKE 'scans/%'`
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiOperations)
    .where(and(
      gte(aiOperations.createdAt, await budgetResetStart(purpose, start)),
      lt(aiOperations.createdAt, end),
      or(isNull(aiOperations.errorCode), ne(aiOperations.errorCode, AI_BUDGET_EXHAUSTED_CODE)),
      operationScope,
    ))

  const pending = activeReservations.get(key) ?? 0
  if (isAiOperationBudgetExhausted({ completed: Number(row?.count ?? 0), pending, limit })) {
    throw new AiBudgetExceededError(limit, purpose)
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
