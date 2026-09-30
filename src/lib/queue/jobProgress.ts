import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { generationJobItems, type GenerationJobItemStatus } from '@/db/schema'
import type { ExamQuestion } from '@/lib/gemini/examSchema'

type ItemIssues = Array<{ severity?: string; code?: string; message?: string; reason?: string }>

/** Cria os slots de forma idempotente antes do processamento do job. */
export async function initializeJobItems(jobId: number, slotNumbers: number[]): Promise<void> {
  const uniqueSlots = [...new Set(slotNumbers)].filter((slot) => Number.isInteger(slot) && slot > 0)
  if (!uniqueSlots.length) return
  await db.insert(generationJobItems)
    .values(uniqueSlots.map((slotNumber) => ({ jobId, slotNumber })))
    .onConflictDoNothing({ target: [generationJobItems.jobId, generationJobItems.slotNumber] })
}

/** Persiste o resultado de uma posição, sem apagar payloads válidos por acidente. */
export async function saveItemProgress(
  jobId: number,
  slotNumber: number,
  status: GenerationJobItemStatus,
  payload?: ExamQuestion | null,
  issues?: ItemIssues | null,
  error?: string | null,
): Promise<void> {
  await db.update(generationJobItems)
    .set({
      status,
      ...(payload !== undefined ? { questionPayload: payload } : {}),
      ...(issues !== undefined ? { issues } : {}),
      ...(error !== undefined ? { lastError: error?.slice(0, 2000) ?? null } : {}),
      ...(status === 'gerando' ? { attempts: sql`${generationJobItems.attempts} + 1` } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(generationJobItems.jobId, jobId), eq(generationJobItems.slotNumber, slotNumber)))
}

/** Questões concluídas ficam disponíveis para montagem e retomada do job. */
export async function getCompletedItems(jobId: number): Promise<Map<number, ExamQuestion>> {
  const rows = await db.select({ slotNumber: generationJobItems.slotNumber, questionPayload: generationJobItems.questionPayload })
    .from(generationJobItems)
    .where(and(eq(generationJobItems.jobId, jobId), eq(generationJobItems.status, 'concluido')))
    .orderBy(asc(generationJobItems.slotNumber))
  return new Map(rows.flatMap((row) => row.questionPayload ? [[row.slotNumber, row.questionPayload as ExamQuestion] as const] : []))
}

/** Retorna slots ainda não concluídos; itens em erro podem ser retomados. */
export async function getPendingSlotNumbers(jobId: number): Promise<number[]> {
  const rows = await db.select({ slotNumber: generationJobItems.slotNumber })
    .from(generationJobItems)
    .where(and(
      eq(generationJobItems.jobId, jobId),
      inArray(generationJobItems.status, ['pendente', 'gerando', 'erro']),
    ))
    .orderBy(asc(generationJobItems.slotNumber))
  return rows.map((row) => row.slotNumber)
}
