import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examScanAuditEvents, examScanPages, examScanUploads } from '@/db/schema'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import { enqueueLocalScanProcessing, LocalScanEnqueueError } from '@/lib/scan-ingest/enqueueLocalScan'

export const runtime = 'nodejs'

const SCAN_ALLOWED_STATUSES = ['aprovado', 'impresso', 'aplicado', 'parcialmente_corrigida', 'corrigido'] as const
const NON_RETRYABLE = new Set(['DUPLICATE_SHEET_SCAN', 'SCAN_BELONGS_TO_ANOTHER_EXAM', 'SUPERSEDED_BY_NEW_SCAN', 'QR_MANUALLY_ASSOCIATED'])

/** Reenfileira a mesma imagem arquivada sem exigir novo upload. */
export async function POST(_req: NextRequest, props: { params: Promise<{ examId: string; uploadId: string }> }) {
  const { examId: rawExamId, uploadId: rawUploadId } = await props.params
  const examId = Number(rawExamId)
  const uploadId = Number(rawUploadId)
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!Number.isFinite(examId) || !Number.isFinite(uploadId)) return NextResponse.json({ error: 'ID inválido.' }, { status: 400 })

  const access = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in access) return access.error
  if (!SCAN_ALLOWED_STATUSES.includes(access.exam.status as (typeof SCAN_ALLOWED_STATUSES)[number])) {
    return NextResponse.json({ error: 'Os scans só podem ser reprocessados após a prova ser aprovada.' }, { status: 409 })
  }

  const upload = await db.query.examScanUploads.findFirst({
    where: and(eq(examScanUploads.id, uploadId), eq(examScanUploads.examId, examId)),
  })
  if (!upload) return NextResponse.json({ error: 'Envio de scan não encontrado.' }, { status: 404 })
  const pages = await db.query.examScanPages.findMany({ where: eq(examScanPages.uploadId, uploadId), columns: { exceptionCode: true, status: true } })
  if (pages.length > 0 && pages.every((page) => page.status === 'processed' && !page.exceptionCode)) {
    return NextResponse.json({ error: 'Este scan já foi processado sem pendências.' }, { status: 409 })
  }
  if (pages.some((page) => page.exceptionCode && NON_RETRYABLE.has(page.exceptionCode))) {
    return NextResponse.json({ error: 'Esta ocorrência precisa ser resolvida pela ação indicada na fila; ela não é uma falha de leitura reprocessável.' }, { status: 409 })
  }

  try {
    const attempt = await enqueueLocalScanProcessing({
      examId,
      uploadId,
      requestedBy: access.currentUser.id,
      generationPayload: access.exam.generationPayload,
      retryOnlyFailed: true,
    })
    if (attempt.status === 'delivered') {
      await db.insert(examScanAuditEvents).values({
        examId,
        uploadId,
        action: 'local_scan_reprocess_requested',
        actorId: access.currentUser.id,
        metadata: { attemptId: attempt.id, jobId: attempt.jobId },
      })
    }
    return NextResponse.json({ attempt }, { status: attempt.status === 'delivered' ? 202 : 503 })
  } catch (error) {
    if (error instanceof LocalScanEnqueueError) {
      const status = ['already_queued', 'nothing_to_retry', 'upload_unavailable', 'layout_unavailable'].includes(error.code) ? 409 : 500
      return NextResponse.json({ error: error.code, message: error.message }, { status })
    }
    return NextResponse.json({ error: 'scan_queue_error', message: 'Não foi possível reprocessar o scan.' }, { status: 500 })
  }
}
