import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examScanAuditEvents, examScanPages, examScanReadings, examScanUploads } from '@/db/schema'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import { openPrivateScanStream } from '@/lib/scan-ingest/privateScanContent'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, props: { params: Promise<{ examId: string; readingId: string }> }) {
  const params = await props.params
  const examId = Number(params.examId); const readingId = Number(params.readingId)
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!Number.isFinite(examId) || !Number.isFinite(readingId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const access = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in access) return access.error
  const row = await db.select({ driveFileId: examScanReadings.cropDriveFileId, mimeType: examScanReadings.cropMimeType, uploadId: examScanPages.uploadId })
    .from(examScanReadings).innerJoin(examScanPages, eq(examScanReadings.pageId, examScanPages.id)).innerJoin(examScanUploads, eq(examScanPages.uploadId, examScanUploads.id))
    .where(and(eq(examScanReadings.id, readingId), eq(examScanUploads.examId, examId))).limit(1)
  const reading = row[0]
  if (!reading?.driveFileId || !reading.mimeType) return NextResponse.json({ error: 'Recorte ainda não disponível.' }, { status: 404 })
  try {
    const stream = await openPrivateScanStream(reading.driveFileId)
    await db.insert(examScanAuditEvents).values({ examId, uploadId: reading.uploadId, action: 'teacher_reading_crop_opened', actorId: access.currentUser.id, metadata: { readingId } })
    return new NextResponse(stream as unknown as BodyInit, { headers: { 'Content-Type': reading.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch { return NextResponse.json({ error: 'Recorte privado indisponível.' }, { status: 502 }) }
}
