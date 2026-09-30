import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examScanAuditEvents, examScanPages, examScanUploads } from '@/db/schema'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import { openPrivateScanStream, renderPrivateScanPdfPage } from '@/lib/scan-ingest/privateScanContent'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, props: { params: Promise<{ examId: string; pageId: string }> }) {
  const params = await props.params
  const examId = Number(params.examId); const pageId = Number(params.pageId)
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!Number.isFinite(examId) || !Number.isFinite(pageId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const access = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in access) return access.error
  const row = await db.select({
    canonicalDriveFileId: examScanPages.canonicalDriveFileId,
    canonicalMimeType: examScanPages.canonicalMimeType,
    uploadDriveFileId: examScanUploads.driveFileId,
    uploadMimeType: examScanUploads.mimeType,
    pageIndex: examScanPages.pageIndex,
    uploadId: examScanPages.uploadId,
    pageStatus: examScanPages.status,
    exceptionCode: examScanPages.exceptionCode,
  })
    .from(examScanPages).innerJoin(examScanUploads, eq(examScanPages.uploadId, examScanUploads.id))
    .where(and(eq(examScanPages.id, pageId), eq(examScanUploads.examId, examId))).limit(1)
  const page = row[0]
  // A failed normalization can be visually misleading (for example, a bad
  // homography may stretch the QR across the page). Keep the original as the
  // default evidence until the page has a successful, QR-backed result.
  const canonicalIsTrusted = page?.canonicalDriveFileId
    && page.canonicalMimeType
    && !(page.pageStatus === 'needs_review' && ['QR_NOT_FOUND', 'QR_CHECKSUM_FAILED', 'MARKERS_MISSING', 'MARKERS_INVALID'].includes(page.exceptionCode ?? ''))
  const driveFileId = canonicalIsTrusted
    ? page.canonicalDriveFileId
    : page?.uploadDriveFileId
  const mimeType = canonicalIsTrusted
    ? page.canonicalMimeType
    : page?.uploadMimeType
  if (!page || !driveFileId || !mimeType) return NextResponse.json({ error: 'Imagem ainda não disponível.' }, { status: 404 })
  try {
    const usingOriginalPdf = !canonicalIsTrusted && mimeType === 'application/pdf'
    const body = usingOriginalPdf
      ? await renderPrivateScanPdfPage(driveFileId, page.pageIndex)
      : await openPrivateScanStream(driveFileId)
    await db.insert(examScanAuditEvents).values({
      examId,
      uploadId: page.uploadId,
      action: 'teacher_canonical_page_opened',
      actorId: access.currentUser.id,
      metadata: { pageId, source: canonicalIsTrusted ? 'canonical_page' : 'original_upload' },
    })
    return new NextResponse(body as unknown as BodyInit, { headers: { 'Content-Type': usingOriginalPdf ? 'image/png' : mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch { return NextResponse.json({ error: 'Imagem privada indisponível.' }, { status: 502 }) }
}
