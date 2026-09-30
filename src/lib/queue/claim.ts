import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { generationJobs, type GenerationJobType } from '@/db/schema'
import { nextStatusAfterFailure } from './types'

export type ClaimedJob = {
  id: number
  batchId: number | null
  jobType: GenerationJobType
  payload: unknown
  attempts: number
  maxAttempts: number
  requestedBy: number
}

function claimedJobFromRow(row: Record<string, unknown>): ClaimedJob {
  return {
    id: Number(row.id),
    batchId: row.batch_id === null ? null : Number(row.batch_id),
    jobType: row.job_type as GenerationJobType,
    payload: row.payload,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    requestedBy: Number(row.requested_by),
  }
}

// Claim atômico do próximo job pendente. FOR UPDATE SKIP LOCKED garante que
// dois workers (ou duas iterações concorrentes) nunca pegam o mesmo job —
// quem chegar depois pula a linha travada em vez de esperar. `attempts` é
// incrementado AQUI (não no fim) pra que uma execução interrompida por
// crash também conte como tentativa gasta.
export async function claimNextJob(jobTypes?: GenerationJobType[]): Promise<ClaimedJob | null> {
  const jobTypeFilter = jobTypes?.length
    ? sql`AND job_type IN (${sql.join(jobTypes.map((jobType) => sql`${jobType}`), sql`, `)})`
    : sql``
  const rows = await db.execute(sql`
    UPDATE generation_jobs
    SET status = 'gerando', started_at = now(), last_heartbeat_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM generation_jobs
      WHERE status = 'pendente' AND (available_at IS NULL OR available_at <= now())
      ${jobTypeFilter}
      ORDER BY priority, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, batch_id, job_type, payload, attempts, max_attempts, requested_by
  `)
  const row = (rows as unknown as Array<Record<string, unknown>>)[0]
  if (!row) return null
  return claimedJobFromRow(row)
}

/**
 * Claim exclusivo para leitura local de scans.
 *
 * Além do lock atômico, dá preferência a uma prova que não esteja sendo lida
 * por outra instância. Assim, um lote grande não toma todos os leitores
 * enquanto existem scans de outras provas aguardando; quando só resta um lote,
 * todas as instâncias voltam a poder atendê-lo.
 */
export async function claimNextScanProcessingJob(): Promise<ClaimedJob | null> {
  const rows = await db.execute(sql`
    UPDATE generation_jobs
    SET status = 'gerando', started_at = now(), last_heartbeat_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT candidate.id
      FROM generation_jobs AS candidate
      WHERE candidate.status = 'pendente'
        AND (candidate.available_at IS NULL OR candidate.available_at <= now())
        AND candidate.job_type = 'processar_scan'
      ORDER BY
        CASE WHEN EXISTS (
          SELECT 1
          FROM generation_jobs AS active_scan
          WHERE active_scan.status = 'gerando'
            AND active_scan.job_type = 'processar_scan'
            AND active_scan.payload ->> 'examId' = candidate.payload ->> 'examId'
        ) THEN 1 ELSE 0 END,
        candidate.priority,
        candidate.id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, batch_id, job_type, payload, attempts, max_attempts, requested_by
  `)
  const row = (rows as unknown as Array<Record<string, unknown>>)[0]
  return row ? claimedJobFromRow(row) : null
}

export async function completeJob(jobId: number, result: { resultExamId?: number; resultRef?: unknown }): Promise<void> {
  await db
    .update(generationJobs)
    .set({
      status: 'concluido',
      resultExamId: result.resultExamId ?? null,
      resultRef: result.resultRef ?? null,
      errorMessage: null,
      finishedAt: new Date(),
    })
    .where(and(eq(generationJobs.id, jobId), eq(generationJobs.status, 'gerando')))
}

/** Remove estados de transcrição que sobreviveram a uma execução terminada.
 * O job é a autoridade da atividade; a leitura só pode continuar ativa se
 * houver outro job cobrindo a mesma página. */
export async function finalizeScanTranscriptionReadings(jobId: number, exceptionCode: 'OCR_MISSING_RESULT' | 'OCR_INTERRUPTED'): Promise<void> {
  await db.execute(sql`
    UPDATE exam_scan_readings reading
    SET exception_code = ${exceptionCode}, updated_at = now()
    FROM exam_scan_pages page, generation_jobs job
    WHERE job.id = ${jobId}
      AND job.job_type = 'transcrever_scan'
      AND page.id = (job.payload ->> 'pageId')::int
      AND reading.page_id = page.id
      AND reading.kind = 'discursive'
      AND COALESCE(reading.review_status, 'pending') = 'pending'
      AND reading.suggested_transcription IS NULL
      AND reading.exception_code IN ('OCR_QUEUED', 'OCR_PROCESSING', 'OCR_DEFERRED', 'AI_BUDGET_DEFERRED')
  `)
}

// Falha de execução: volta pra 'pendente' enquanto houver tentativa
// sobrando, senão 'erro' definitivo. errorMessage fica gravada nos dois
// casos — durante um retry a UI mostra o último erro visto.
export async function failJob(job: Pick<ClaimedJob, 'id' | 'attempts' | 'maxAttempts'>, errorMessage: string): Promise<'pendente' | 'erro'> {
  const nextStatus = nextStatusAfterFailure(job.attempts, job.maxAttempts)
  await db
    .update(generationJobs)
    .set({
      status: nextStatus,
      errorMessage: errorMessage.slice(0, 2000),
      finishedAt: nextStatus === 'erro' ? new Date() : null,
    })
    .where(and(eq(generationJobs.id, job.id), eq(generationJobs.status, 'gerando')))
  return nextStatus
}

/** Cota não é falha do pedido: devolve o job à fila sem consumir tentativa. */
export async function deferJobForAiBudget(job: Pick<ClaimedJob, 'id' | 'attempts'>, availableAt: Date, message: string): Promise<void> {
  await db.update(generationJobs).set({
    status: 'pendente', attempts: Math.max(0, job.attempts - 1), availableAt,
    errorMessage: message.slice(0, 2000), startedAt: null, finishedAt: null,
  }).where(and(eq(generationJobs.id, job.id), eq(generationJobs.status, 'gerando')))
}

/** Limite/indisponibilidade do provedor é temporário e não consome tentativa. */

/** Heartbeat: o worker renova enquanto processa, impedindo requeue prematuro. */
export async function heartbeatJob(jobId: number): Promise<void> {
  await db.update(generationJobs)
    .set({ lastHeartbeatAt: new Date() })
    .where(and(eq(generationJobs.id, jobId), eq(generationJobs.status, 'gerando')))
}

export async function deferJobForProvider(job: Pick<ClaimedJob, 'id' | 'attempts'>, availableAt: Date, message: string): Promise<void> {
  return deferJobForAiBudget(job, availableAt, message)
}

// Recuperação de crash: job preso em 'gerando' além do limite (worker caiu
// no meio) volta pra fila se ainda tem tentativa, senão vira erro. Rodado
// na subida do worker e periodicamente durante o loop.
export async function requeueStaleJobs(staleMinutes = 15): Promise<{ requeued: number; failed: number }> {
  const cutoff = sql`now() - make_interval(mins => ${staleMinutes})`

  const requeued = await db.execute(sql`
    UPDATE generation_jobs
    SET status = 'pendente', started_at = NULL, available_at = now(),
        error_message = 'Execução interrompida (worker reiniciou no meio); reenfileirado automaticamente.'
    WHERE status = 'gerando' AND COALESCE(last_heartbeat_at, started_at) < ${cutoff} AND attempts < max_attempts
    RETURNING id
  `)
  const failed = await db.execute(sql`
    UPDATE generation_jobs
    SET status = 'erro', finished_at = now(),
        error_message = 'Execução interrompida (worker reiniciou no meio) e sem tentativas restantes.'
    WHERE status = 'gerando' AND COALESCE(last_heartbeat_at, started_at) < ${cutoff} AND attempts >= max_attempts
    RETURNING id
  `)

  const requeuedRows = requeued as unknown as Array<{ id: number }>
  const failedRows = failed as unknown as Array<{ id: number }>
  if (requeuedRows.length) {
    await db.execute(sql`
      UPDATE exam_scan_readings reading
      SET exception_code = 'OCR_QUEUED', updated_at = now()
      FROM exam_scan_pages page, generation_jobs job
      WHERE job.id IN (${sql.join(requeuedRows.map((row) => sql`${row.id}`), sql`, `)})
        AND page.id = (job.payload ->> 'pageId')::int
        AND reading.page_id = page.id
        AND reading.kind = 'discursive'
        AND COALESCE(reading.review_status, 'pending') = 'pending'
        AND reading.suggested_transcription IS NULL
    `)
  }
  if (failedRows.length) {
    await db.execute(sql`
      UPDATE exam_scan_readings reading
      SET exception_code = 'OCR_INTERRUPTED', updated_at = now()
      FROM exam_scan_pages page, generation_jobs job
      WHERE job.id IN (${sql.join(failedRows.map((row) => sql`${row.id}`), sql`, `)})
        AND page.id = (job.payload ->> 'pageId')::int
        AND reading.page_id = page.id
        AND reading.kind = 'discursive'
        AND COALESCE(reading.review_status, 'pending') = 'pending'
        AND reading.suggested_transcription IS NULL
    `)
  }

  return {
    requeued: requeuedRows.length,
    failed: failedRows.length,
  }
}

// Ações do usuário (autorização é responsabilidade da rota chamadora).

export async function cancelJob(jobId: number): Promise<boolean> {
  const rows = await db
    .update(generationJobs)
    .set({ status: 'cancelado', finishedAt: new Date() })
    .where(and(eq(generationJobs.id, jobId), eq(generationJobs.status, 'pendente')))
    .returning({ id: generationJobs.id })
  return rows.length > 0
}

export async function retryJob(jobId: number): Promise<boolean> {
  const rows = await db
    .update(generationJobs)
    .set({ status: 'pendente', attempts: 0, errorMessage: null, startedAt: null, finishedAt: null, availableAt: null })
    .where(and(eq(generationJobs.id, jobId), eq(generationJobs.status, 'erro')))
    .returning({ id: generationJobs.id })
  return rows.length > 0
}
