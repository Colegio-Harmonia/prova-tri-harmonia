import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { generationJobItems, type GenerationJobItemStatus } from '@/db/schema'
import type { ExamQuestion } from '@/lib/gemini/examSchema'

type ItemIssues = Array<{ severity?: string; code?: string; message?: string; reason?: string; location?: string; resolutionCheck?: string; report?: unknown }>

function isMissingCurrentStageColumn(error: unknown): boolean {
  let candidate: unknown = error
  const seen = new Set<unknown>()
  while (candidate && typeof candidate === 'object' && !seen.has(candidate)) {
    seen.add(candidate)
    const value = candidate as { code?: unknown; message?: unknown; cause?: unknown }
    if (value.code === '42703' && typeof value.message === 'string' && value.message.includes('current_stage')) return true
    candidate = value.cause
  }
  return false
}

export type QualityRepairHistoryEntry = {
  attempt: number
  stage: 'targeted_repair' | 'same_topic_regeneration' | 'alternate_angle_regeneration' | 'safe_regeneration'
  blockingCriteriaBefore: string[]
  authorizedFields: string[]
  changedFields: string[]
  contentIdentical: boolean
  blockingCriteriaAfter: string[]
  outcome: 'resolved' | 'repair_ignored' | 'aplicado_jev_discorda' | 'same_criteria_rejected' | 'new_defect' | 'escopo_violado' | 'not_audited' | 'accepted_without_reaudit'
  durationMs: number
  recordedAt: string
}

export type QuestionStageCheckpoints = {
  version: 1
  approvedStatement?: Record<string, unknown>
  visualDecision?: Record<string, unknown>
  responsePayload?: ExamQuestion
  answerAudit?: Record<string, unknown>
}

function isMissingStageCheckpointsColumn(error: unknown): boolean {
  let candidate: unknown = error
  const seen = new Set<unknown>()
  while (candidate && typeof candidate === 'object' && !seen.has(candidate)) {
    seen.add(candidate)
    const value = candidate as { code?: unknown; message?: unknown; cause?: unknown }
    if (value.code === '42703' && typeof value.message === 'string' && value.message.includes('stage_checkpoints')) return true
    candidate = value.cause
  }
  return false
}

/** Guarda checkpoint mesclado sem apagar dados anteriores de outras etapas. */
export async function saveQuestionStageCheckpoint(jobId: number, slotNumber: number, checkpoint: Partial<QuestionStageCheckpoints>): Promise<void> {
  try {
    await db.update(generationJobItems)
      .set({ stageCheckpoints: sql`COALESCE(${generationJobItems.stageCheckpoints}, '{}'::jsonb) || ${JSON.stringify(checkpoint)}::jsonb`, updatedAt: new Date() })
      .where(and(eq(generationJobItems.jobId, jobId), eq(generationJobItems.slotNumber, slotNumber)))
  } catch (error) {
    if (!isMissingStageCheckpointsColumn(error)) throw error
  }
}

/** Recupera checkpoints por questão para retomar na primeira etapa pendente. */
export async function getQuestionStageCheckpoints(jobId: number): Promise<Map<number, QuestionStageCheckpoints>> {
  try {
    const rows = await db.select({ slotNumber: generationJobItems.slotNumber, stageCheckpoints: generationJobItems.stageCheckpoints })
      .from(generationJobItems)
      .where(eq(generationJobItems.jobId, jobId))
      .orderBy(asc(generationJobItems.slotNumber))
    return new Map(rows.map((row) => [row.slotNumber, (row.stageCheckpoints ?? { version: 1 }) as QuestionStageCheckpoints]))
  } catch (error) {
    if (isMissingStageCheckpointsColumn(error)) return new Map()
    throw error
  }
}

/** Reserva atomicamente uma etapa de correção/regeneração e devolve seu índice persistido. */
export async function reserveQualityRepairAttempt(jobId: number, slotNumber: number, limit = 5): Promise<number | null> {
  const rows = await db.update(generationJobItems)
    .set({ qualityRepairAttempts: sql`${generationJobItems.qualityRepairAttempts} + 1`, updatedAt: new Date() })
    .where(and(
      eq(generationJobItems.jobId, jobId),
      eq(generationJobItems.slotNumber, slotNumber),
      lt(generationJobItems.qualityRepairAttempts, limit),
    ))
    .returning({ attempts: generationJobItems.qualityRepairAttempts })
  return rows.length === 1 ? Number(rows[0]!.attempts) : null
}

/** Falhas transitórias de provedor não consomem uma etapa da escada. */
export async function releaseQualityRepairAttempt(jobId: number, slotNumber: number): Promise<void> {
  await db.update(generationJobItems)
    .set({ qualityRepairAttempts: sql`GREATEST(0, ${generationJobItems.qualityRepairAttempts} - 1)`, updatedAt: new Date() })
    .where(and(eq(generationJobItems.jobId, jobId), eq(generationJobItems.slotNumber, slotNumber)))
}

export async function getQualityRepairHistory(jobId: number, slotNumber: number): Promise<QualityRepairHistoryEntry[]> {
  const rows = await db.select({ history: generationJobItems.qualityRepairHistory })
    .from(generationJobItems)
    .where(and(eq(generationJobItems.jobId, jobId), eq(generationJobItems.slotNumber, slotNumber)))
    .limit(1)
  const value = rows[0]?.history
  return Array.isArray(value) ? value as QualityRepairHistoryEntry[] : []
}

export async function appendQualityRepairHistory(jobId: number, slotNumber: number, entry: QualityRepairHistoryEntry): Promise<void> {
  await db.update(generationJobItems)
    .set({ qualityRepairHistory: sql`COALESCE(${generationJobItems.qualityRepairHistory}, '[]'::jsonb) || ${JSON.stringify(entry)}::jsonb`, updatedAt: new Date() })
    .where(and(eq(generationJobItems.jobId, jobId), eq(generationJobItems.slotNumber, slotNumber)))
}

/** Cria os slots de forma idempotente antes do processamento do job. */
export async function initializeJobItems(jobId: number, slotNumbers: number[]): Promise<void> {
  const uniqueSlots = [...new Set(slotNumbers)].filter((slot) => Number.isInteger(slot) && slot > 0)
  if (!uniqueSlots.length) return
  // Insere apenas os campos estáveis. Isso mantém a fila inicializável durante
  // o deploy em que o código novo chega antes da migration de current_stage.
  const values = sql.join(uniqueSlots.map((slotNumber) => sql`(${jobId}, ${slotNumber})`), sql`, `)
  await db.execute(sql`
    INSERT INTO generation_job_items (job_id, slot_number)
    VALUES ${values}
    ON CONFLICT (job_id, slot_number) DO NOTHING
  `)
}

/** Etapa visível da questão, para acompanhar o fluxo granular na fila. */
export async function setJobItemStage(jobId: number, slotNumber: number, currentStage: string | null): Promise<void> {
  try {
    await db.update(generationJobItems)
      .set({ currentStage, updatedAt: new Date() })
      .where(and(eq(generationJobItems.jobId, jobId), eq(generationJobItems.slotNumber, slotNumber)))
  } catch (error) {
    if (!isMissingCurrentStageColumn(error)) throw error
  }
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
      ...(status === 'gerando' && payload === undefined ? { questionPayload: null } : {}),
      ...(issues !== undefined ? { issues } : status === 'concluido' ? { issues: null } : {}),
      ...(error !== undefined ? { lastError: error?.slice(0, 2000) ?? null } : status === 'concluido' ? { lastError: null } : {}),
      ...(status === 'gerando' ? { attempts: sql`${generationJobItems.attempts} + 1` } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(generationJobItems.jobId, jobId), eq(generationJobItems.slotNumber, slotNumber)))
  if (status === 'gerando' && payload === undefined) await setJobItemStage(jobId, slotNumber, 'gerando_enunciado')
  if (status === 'gerando' && payload) await setJobItemStage(jobId, slotNumber, 'aguardando_validacao_final')
  // Preserva a última etapa quando uma questão falha para que a fila possa
  // mostrar em qual fase a geração foi interrompida.
  if (status === 'concluido') {
    await setJobItemStage(jobId, slotNumber, null)
  }
}

/** Questões com conteúdo já produzido podem ser reutilizadas na retomada. */
export async function getReusableQuestionPayloads(jobId: number): Promise<Map<number, ExamQuestion>> {
  const rows = await db.select({ slotNumber: generationJobItems.slotNumber, questionPayload: generationJobItems.questionPayload })
    .from(generationJobItems)
    .where(and(eq(generationJobItems.jobId, jobId), inArray(generationJobItems.status, ['concluido', 'gerando', 'erro'])))
    .orderBy(asc(generationJobItems.slotNumber))
  return new Map(rows.flatMap((row) => row.questionPayload ? [[row.slotNumber, row.questionPayload as ExamQuestion] as const] : []))
}

/** Pareceres Jev aprovados são checkpoints: retomadas não os executam de novo. */
export async function getPersistedQuestionQualityReports(jobId: number): Promise<Map<number, Record<string, unknown>>> {
  const rows = await db.select({ slotNumber: generationJobItems.slotNumber, issues: generationJobItems.issues })
    .from(generationJobItems)
    .where(and(eq(generationJobItems.jobId, jobId), eq(generationJobItems.status, 'concluido')))
  const reports = new Map<number, Record<string, unknown>>()
  for (const row of rows) {
    const issueList = Array.isArray(row.issues) ? row.issues as Array<Record<string, unknown>> : []
    const stored = issueList.find((issue) => issue.code === 'JEV_QUALITY_REPORT' && issue.report && typeof issue.report === 'object')
    if (stored?.report) reports.set(row.slotNumber, stored.report as Record<string, unknown>)
  }
  return reports
}

/** Slots sem conteúdo reutilizável; itens em erro precisam ser gerados de novo. */
export function shouldRegenerateQuestionItem(status: string, hasPayload: boolean): boolean {
  return status === 'pendente' || status === 'erro' || (status === 'gerando' && !hasPayload)
}

export async function getPendingSlotNumbers(jobId: number): Promise<number[]> {
  const rows = await db.select({ slotNumber: generationJobItems.slotNumber, status: generationJobItems.status, questionPayload: generationJobItems.questionPayload })
    .from(generationJobItems)
    .where(and(
      eq(generationJobItems.jobId, jobId),
      inArray(generationJobItems.status, ['pendente', 'gerando', 'erro']),
    ))
    .orderBy(asc(generationJobItems.slotNumber))
  return rows.filter((row) => shouldRegenerateQuestionItem(row.status, Boolean(row.questionPayload))).map((row) => row.slotNumber)
}
