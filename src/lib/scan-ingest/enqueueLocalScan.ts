import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { examScanAuditEvents, examScanPages, examScanProcessingAttempts, examScanUploads, generationJobs } from '@/db/schema'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { planSheetPages } from '@/lib/scan-sheets/sheetLayout'
import { countLogicalScanPages } from '@/lib/scan-ingest/privateScanContent'

export class LocalScanEnqueueError extends Error {
  constructor(public readonly code: 'upload_unavailable' | 'layout_unavailable' | 'queue_error', message: string) {
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
}) {
  const upload = await db.query.examScanUploads.findFirst({
    where: and(eq(examScanUploads.id, input.uploadId), eq(examScanUploads.examId, input.examId)),
  })
  if (!upload || upload.status !== 'archived' || !upload.driveFileId) {
    throw new LocalScanEnqueueError('upload_unavailable', 'O scan precisa estar arquivado antes de entrar na fila.')
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

  let attempt: { id: number; attemptNumber: number }
  let pageCount = 0
  try {
    attempt = await db.transaction(async (tx) => {
      const pages = await tx.query.examScanPages.findMany({
        where: eq(examScanPages.uploadId, input.uploadId),
        orderBy: [asc(examScanPages.pageIndex)],
      })
      if (pages.length === 0) {
        await tx.insert(examScanPages).values(Array.from({ length: logicalPageCount }, (_, index) => ({ uploadId: input.uploadId, pageIndex: index + 1, status: 'queued' as const })))
        pageCount = logicalPageCount
      } else {
        pageCount = pages.length
        await tx.update(examScanPages)
          .set({ status: 'queued', exceptionCode: null, updatedAt: new Date() })
          .where(eq(examScanPages.uploadId, input.uploadId))
      }

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
      return created
    })
  } catch (error) {
    if (error instanceof LocalScanEnqueueError) throw error
    throw new LocalScanEnqueueError('queue_error', 'Nao foi possivel criar a tentativa de processamento.')
  }

  try {
    const [job] = await db.insert(generationJobs).values({
      jobType: 'processar_scan',
      payload: { uploadId: input.uploadId, examId: input.examId, attemptId: attempt.id },
      requestedBy: input.requestedBy,
    }).returning({ jobId: generationJobs.id })
    await db.update(examScanProcessingAttempts)
      .set({ status: 'delivered', deliveredAt: new Date(), deliveryErrorCode: null, updatedAt: new Date() })
      .where(eq(examScanProcessingAttempts.id, attempt.id))
    await db.insert(examScanAuditEvents).values({
      examId: input.examId,
      uploadId: input.uploadId,
      action: 'local_scan_dispatch_delivered',
      actorId: input.requestedBy,
      metadata: { attemptNumber: attempt.attemptNumber, jobId: job.jobId },
    })
    return { ...attempt, status: 'delivered' as const, pageCount, jobId: job.jobId }
  } catch {
    await db.update(examScanProcessingAttempts)
      .set({ status: 'delivery_failed', deliveryErrorCode: 'JOB_ENQUEUE_FAILED', updatedAt: new Date() })
      .where(eq(examScanProcessingAttempts.id, attempt.id))
    return { ...attempt, status: 'delivery_failed' as const, pageCount, jobId: null }
  }
}

