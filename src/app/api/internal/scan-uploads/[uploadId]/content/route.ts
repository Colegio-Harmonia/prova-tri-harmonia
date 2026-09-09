import { Readable } from 'stream'
import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { examScanAuditEvents, examScanProcessingAttempts, examScanUploads } from '@/db/schema'
import { verifyN8nScanRequest } from '@/lib/scan-ingest/n8nAuth'
import { openPrivateScanStream } from '@/lib/scan-ingest/privateScanContent'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, props: { params: Promise<{ uploadId: string }> }) {
  const params = await props.params
  const uploadId = Number(params.uploadId)
  const attemptId = Number(req.nextUrl.searchParams.get('attemptId'))
  if (!Number.isFinite(uploadId) || !Number.isFinite(attemptId)) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const pathAndQuery = `${req.nextUrl.pathname}${req.nextUrl.search}`
  const authenticated = verifyN8nScanRequest({
    method: req.method,
    pathAndQuery,
    timestamp: req.headers.get('x-provatri-timestamp'),
    signature: req.headers.get('x-provatri-signature'),
  })
  if (!authenticated) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const [upload, attempt] = await Promise.all([
    db.query.examScanUploads.findFirst({ where: and(eq(examScanUploads.id, uploadId), eq(examScanUploads.status, 'archived')) }),
    db.query.examScanProcessingAttempts.findFirst({
      where: and(eq(examScanProcessingAttempts.id, attemptId), eq(examScanProcessingAttempts.uploadId, uploadId)),
    }),
  ])
  if (!upload?.driveFileId || !attempt || !['queued', 'delivered'].includes(attempt.status)) {
    return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  }

  let stream: Readable
  try {
    stream = await openPrivateScanStream(upload.driveFileId)
  } catch {
    return NextResponse.json({ error: 'Arquivo indisponível' }, { status: 502 })
  }
  await db.insert(examScanAuditEvents).values({
    examId: upload.examId,
    uploadId,
    action: 'n8n_content_opened',
    metadata: { attemptId },
  })

  return new NextResponse(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': upload.mimeType,
      'Content-Disposition': `attachment; filename="scan-${uploadId}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
