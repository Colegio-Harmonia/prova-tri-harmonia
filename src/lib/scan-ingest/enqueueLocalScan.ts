import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { examScanAuditEvents, examScanPages, examScanProcessingAttempts, examScanUploads, generationJobs } from '@/db/schema'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { planSheetPages } from '@/lib/scan-sheets/sheetLayout'
import { countLogicalScanPages } from '@/lib/scan-ingest/privateScanContent'
import { SCAN_PIPELINE_VERSION } from '@/lib/scan-ingest/scanPipeline'

export class LocalScanEnqueueError extends Error {
  constructor(public readonly code: 'upload_unavailable' | 'layout_unavailable' | 'already_queued' | 'nothing_to_retry' | 'queue_error', message: string) {
    super(message)
    this.name = 'LocalScanEnqueueError'
  }
}

/**
 * Creates a durable local processing attempt. It is deliberately shared by
 * the upload and retry endpoints so an archived file never waits for a
 * browser-only "send for processing" action.
 */
export async function enqueueLocalScanProcessing(input: {
  examId: number
  uploadId: number
  requestedBy: number
  generationPayload: unknown
  retryOnlyFailed?: boolean
}) {
  const upload = await db.query.examScanUploads.findFirst({
    where: and(eq(examScanUploads.id, input.uploadId), eq(examScanUploads.examId, input.examId)),
  })
  if (!upload || upload.status !== 'archived' || !upload.driveFileId) {
    throw new LocalScanEnqueueError('upload_unavailable', 'O scan precisa estar arquivado antes de entrar na fila.')
  }

  // A ação de reprocessar pode ser disparada por dois cliques, duas abas ou
  // por uma atualização automática da tela. O payload é a chave idempotente
  // do processamento: não criamos uma segunda tentativa enquanto a anterior
  // ainda está pendente ou sendo executada.
  const activeJob = await db.execute(sql`
    SELECT id
    FROM generation_jobs
    WHERE job_type = 'processar_scan'
      AND status IN ('pendente', 'gerando')
      AND payload ->> 'uploadId' = ${String(input.uploadId)}
    ORDER BY id DESC
    LIMIT 1
  `)
  if ((activeJob as unknown as Array<unknown>).length > 0) {
    throw new LocalScanEnqueueError('already_queued', 'Este scan já está aguardando processamento ou sendo lido.')
  }

  // Repetir a mesma leitura sobre os mesmos bytes e a mesma versão não muda
  // o resultado quando todas as páginas já terminaram. Se um lote tiver uma
  // página concluída e outra com erro, porém, o retry precisa continuar
  // disponível apenas para a página pendente; um audit da página concluída
  // não pode bloquear a recuperação do restante do lote.
  const currentPages = await db.query.examScanPages.findMany({
    where: eq(examScanPages.uploadId, input.uploadId),
    columns: { status: true, exceptionCode: true },
  })
  const hasRetryablePage = currentPages.length === 0 || currentPages.some((page) => page.status !== 'processed' || Boolean(page.exceptionCode))
  const samePipelineAttempt = await db.execute(sql`
    SELECT id
    FROM exam_scan_audit_events
    WHERE upload_id = ${input.uploadId}
      AND action = 'local_scan_processed'
      AND metadata ->> 'pipelineVersion' = ${SCAN_PIPELINE_VERSION}
    ORDER BY id DESC
    LIMIT 1
  `)
  if (!hasRetryablePage && (samePipelineAttempt as unknown as Array<unknown>).length > 0) {
    throw new LocalScanEnqueueError('nothing_to_retry', 'Este scan já foi processado com a versão atual do leitor.')
  }

  let logicalPageCount: number
  try {
    logicalPageCount = await countLogicalScanPages(upload.driveFileId, upload.mimeType)
  } catch {
    throw new LocalScanEnqueueError('queue_error', 'Nao foi possivel identificar as paginas do arquivo escaneado.')
  }

  try {
    planSheetPages((input.generationPayload as ExamGenerationResult).questions)
  } catch {
    throw new LocalScanEnqueueError('layout_unavailable', 'O layout PTR1 da prova nao esta disponivel para processamento.')
  }

  let attempt: { id: number; attemptNumber: number; pageIds: number[] }
  let pageCount = 0
  try {
    attempt = await db.transaction(async (tx) => {
      const pages = await tx.query.examScanPages.findMany({
        where: eq(examScanPages.uploadId, input.uploadId),
        orderBy: [asc(examScanPages.pageIndex)],
      })
      let pageIds: number[]
      if (pages.length === 0) {
        await tx.insert(examScanPages).values(Array.from({ length: logicalPageCount }, (_, index) => ({ uploadId: input.uploadId, pageIndex: index + 1, status: 'queued' as const })))
        const createdPages = await tx.query.examScanPages.findMany({ where: eq(examScanPages.uploadId, input.uploadId), columns: { id: true } })
        pageIds = createdPages.map((page) => page.id)
      } else {
        pageIds = input.retryOnlyFailed
          ? pages.filter((page) => page.status !== 'processed' || Boolean(page.exceptionCode)).map((page) => page.id)
          : pages.map((page) => page.id)
        if (pageIds.length === 0) throw new LocalScanEnqueueError('nothing_to_retry', 'Este scan já foi processado sem pendências.')
        await tx.update(examScanPages)
          .set({ status: 'queued', exceptionCode: null, updatedAt: new Date() })
          .where(inArray(examScanPages.id, pageIds))
      }
      pageCount = pageIds.length

      const attempts = await tx.query.examScanProcessingAttempts.findMany({
        where: eq(examScanProcessingAttempts.uploadId, input.uploadId),
        orderBy: [asc(examScanProcessingAttempts.attemptNumber)],
      })
      const attemptNumber = (attempts.at(-1)?.attemptNumber ?? 0) + 1
      const [created] = await tx.insert(examScanProcessingAttempts).values({
        uploadId: input.uploadId,
        attemptNumber,
        requestedBy: input.requestedBy,
      }).returning({ id: examScanProcessingAttempts.id, attemptNumber: examScanProcessingAttempts.attemptNumber })

      await tx.insert(examScanAuditEvents).values({
        examId: input.examId,
        uploadId: input.uploadId,
        action: 'local_scan_dispatch_queued',
        actorId: input.requestedBy,
        metadata: { attemptNumber },
      })
      return { ...created, pageIds }
    })
  } catch (error) {
    if (error instanceof LocalScanEnqueueError) throw error
    throw new LocalScanEnqueueError('queue_error', 'Nao foi possivel criar a tentativa de processamento.')
  }

  try {
    const jobs = await db.insert(generationJobs).values(attempt.pageIds.map((pageId) => ({
      jobType: 'processar_scan' as const,
      payload: { uploadId: input.uploadId, examId: input.examId, attemptId: attempt.id, pageId },
      requestedBy: input.requestedBy,
      // Uma página = um job. Assim uma folha lenta ou defeituosa não segura
      // as demais e o retry pode voltar somente à página problemática.
      priority: 2,
    }))).returning({ jobId: generationJobs.id })
    const jobIds = jobs.map((job) => job.jobId)
    await db.update(examScanProcessingAttempts)
      .set({ status: 'delivered', deliveredAt: new Date(), deliveryErrorCode: null, updatedAt: new Date() })
      .where(eq(examScanProcessingAttempts.id, attempt.id))
    await db.insert(examScanAuditEvents).values({
      examId: input.examId,
      uploadId: input.uploadId,
      action: 'local_scan_dispatch_delivered',
      actorId: input.requestedBy,
      metadata: { attemptNumber: attempt.attemptNumber, jobIds, pageIds: attempt.pageIds },
    })
    return { ...attempt, status: 'delivered' as const, pageCount, jobId: jobIds[0] ?? null, jobIds }
  } catch {
    await db.update(examScanProcessingAttempts)
      .set({ status: 'delivery_failed', deliveryErrorCode: 'JOB_ENQUEUE_FAILED', updatedAt: new Date() })
      .where(eq(examScanProcessingAttempts.id, attempt.id))
    return { ...attempt, status: 'delivery_failed' as const, pageCount, jobId: null, jobIds: [] }
  }
}
