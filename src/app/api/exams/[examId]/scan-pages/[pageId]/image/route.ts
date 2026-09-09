import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examScanAuditEvents, examScanPages, examScanUploads } from '@/db/schema'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import { openPrivateScanStream } from '@/lib/scan-ingest/privateScanContent'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, props: { params: Promise<{ examId: string; pageId: string }> }) {
  const params = await props.params
  const examId = Number(params.examId); const pageId = Number(params.pageId)
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!Number.isFinite(examId) || !Number.isFinite(pageId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const access = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in access) return access.error
  const row = await db.select({ driveFileId: examScanPages.canonicalDriveFileId, mimeType: examScanPages.canonicalMimeType, uploadId: examScanPages.uploadId })
    .from(examScanPages).innerJoin(examScanUploads, eq(examScanPages.uploadId, examScanUploads.id))
    .where(and(eq(examScanPages.id, pageId), eq(examScanUploads.examId, examId))).limit(1)
  const page = row[0]
  if (!page?.driveFileId || !page.mimeType) return NextResponse.json({ error: 'Imagem ainda não disponível.' }, { status: 404 })
  try {
    const stream = await openPrivateScanStream(page.driveFileId)
    await db.insert(examScanAuditEvents).values({ examId, uploadId: page.uploadId, action: 'teacher_canonical_page_opened', actorId: access.currentUser.id, metadata: { pageId } })
    return new NextResponse(stream as unknown as BodyInit, { headers: { 'Content-Type': page.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch { return NextResponse.json({ error: 'Imagem privada indisponível.' }, { status: 502 }) }
}
