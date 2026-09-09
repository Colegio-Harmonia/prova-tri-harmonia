import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { examScanPages, examScanProcessingAttempts, examScanUploads } from '@/db/schema'
import { verifyN8nScanRequest } from '@/lib/scan-ingest/n8nAuth'
import { stageAndArchivePrivateArtifact } from '@/lib/scan-ingest/privateArtifact'
import { ScanFileValidationError } from '@/lib/scan-ingest/scanFile'

export const runtime = 'nodejs'

export async function PUT(req: NextRequest, props: { params: Promise<{ pageId: string }> }) {
  const { pageId: pageParam } = await props.params
  const pageId = Number(pageParam)
  const attemptId = Number(req.nextUrl.searchParams.get('attemptId'))
  if (!Number.isFinite(pageId) || !Number.isFinite(attemptId)) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  const bytes = Buffer.from(await req.arrayBuffer())
  if (!verifyN8nScanRequest({ method: req.method, pathAndQuery: `${req.nextUrl.pathname}${req.nextUrl.search}`, body: bytes, timestamp: req.headers.get('x-provatri-timestamp'), signature: req.headers.get('x-provatri-signature') })) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const page = await db.query.examScanPages.findFirst({ where: eq(examScanPages.id, pageId) })
  const attempt = await db.query.examScanProcessingAttempts.findFirst({ where: and(eq(examScanProcessingAttempts.id, attemptId), eq(examScanProcessingAttempts.uploadId, page?.uploadId ?? -1)) })
  const upload = page ? await db.query.examScanUploads.findFirst({ where: and(eq(examScanUploads.id, page.uploadId), eq(examScanUploads.status, 'archived')) }) : null
  if (!page || !attempt || !upload) return NextResponse.json({ error: 'Artefato não corresponde a uma tentativa arquivada.' }, { status: 409 })
  try {
    const artifact = await stageAndArchivePrivateArtifact({
      bytes, examId: upload.examId, uploadId: upload.id, artifact: 'canonical_page', artifactId: page.id,
      saveStagingKey: async (key) => { await db.update(examScanPages).set({ canonicalStagingObjectKey: key, canonicalArchiveErrorCode: null, updatedAt: new Date() }).where(eq(examScanPages.id, page.id)) },
      saveArchived: async (result, inspection) => { await db.update(examScanPages).set({ canonicalDriveFileId: result.driveFileId, canonicalVerifiedSha256: result.verifiedSha256, canonicalMimeType: inspection.mimeType, canonicalStagingObjectKey: null, canonicalArchivedAt: new Date(), canonicalArchiveErrorCode: null, updatedAt: new Date() }).where(eq(examScanPages.id, page.id)) },
      saveFailure: async () => { await db.update(examScanPages).set({ canonicalArchiveErrorCode: 'ARCHIVE_FAILED', updatedAt: new Date() }).where(eq(examScanPages.id, page.id)) },
    })
    return NextResponse.json({ stored: true, sha256: artifact.verifiedSha256 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof ScanFileValidationError ? error.message : 'Não foi possível arquivar a página privada.' }, { status: 502 })
  }
}
