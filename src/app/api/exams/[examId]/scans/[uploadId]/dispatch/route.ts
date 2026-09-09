import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import { enqueueLocalScanProcessing, LocalScanEnqueueError } from '@/lib/scan-ingest/enqueueLocalScan'

export const runtime = 'nodejs'

const SCAN_ALLOWED_STATUSES = ['aprovado', 'impresso', 'aplicado', 'corrigido'] as const

export async function POST(_req: NextRequest, props: { params: Promise<{ examId: string; uploadId: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Nao autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  const uploadId = Number(params.uploadId)
  if (!Number.isFinite(examId) || !Number.isFinite(uploadId)) return NextResponse.json({ error: 'ID invalido' }, { status: 400 })

  const access = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in access) return access.error
  if (!SCAN_ALLOWED_STATUSES.includes(access.exam.status as (typeof SCAN_ALLOWED_STATUSES)[number])) {
    return NextResponse.json({ error: 'O processamento de scans so pode comecar apos a prova ser aprovada.' }, { status: 409 })
  }

  try {
    const attempt = await enqueueLocalScanProcessing({
      examId,
      uploadId,
      requestedBy: access.currentUser.id,
      generationPayload: access.exam.generationPayload,
    })
    return NextResponse.json({ attempt }, { status: attempt.status === 'delivered' ? 202 : 503 })
  } catch (error) {
    if (error instanceof LocalScanEnqueueError) {
      const status = error.code === 'upload_unavailable' ? 409 : error.code === 'layout_unavailable' ? 409 : 500
      return NextResponse.json({ error: error.code, message: error.message }, { status })
    }
    return NextResponse.json({ error: 'scan_queue_error', message: 'Nao foi possivel iniciar o processamento do scan.' }, { status: 500 })
  }
}
