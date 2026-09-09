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
    SET status = 'gerando', started_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM generation_jobs
      WHERE status = 'pendente'
      ${jobTypeFilter}
      ORDER BY priority, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, batch_id, job_type, payload, attempts, max_attempts, requested_by
  `)
  const row = (rows as unknown as Array<Record<string, unknown>>)[0]
  if (!row) return null
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

// Recuperação de crash: job preso em 'gerando' além do limite (worker caiu
// no meio) volta pra fila se ainda tem tentativa, senão vira erro. Rodado
// na subida do worker e periodicamente durante o loop.
export async function requeueStaleJobs(staleMinutes = 15): Promise<{ requeued: number; failed: number }> {
  const cutoff = sql`now() - make_interval(mins => ${staleMinutes})`

  const requeued = await db.execute(sql`
    UPDATE generation_jobs
    SET status = 'pendente', error_message = 'Execução interrompida (worker reiniciou no meio); reenfileirado automaticamente.'
    WHERE status = 'gerando' AND started_at < ${cutoff} AND attempts < max_attempts
    RETURNING id
  `)
  const failed = await db.execute(sql`
    UPDATE generation_jobs
    SET status = 'erro', finished_at = now(),
        error_message = 'Execução interrompida (worker reiniciou no meio) e sem tentativas restantes.'
    WHERE status = 'gerando' AND started_at < ${cutoff} AND attempts >= max_attempts
    RETURNING id
  `)

  return {
    requeued: (requeued as unknown as unknown[]).length,
    failed: (failed as unknown as unknown[]).length,
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
    .set({ status: 'pendente', attempts: 0, errorMessage: null, startedAt: null, finishedAt: null })
    .where(and(eq(generationJobs.id, jobId), eq(generationJobs.status, 'erro')))
    .returning({ id: generationJobs.id })
  return rows.length > 0
}
