import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { examScanPages, examScanProcessingAttempts, examScanReadings, examScanUploads } from '@/db/schema'
import { verifyN8nScanRequest } from '@/lib/scan-ingest/n8nAuth'
import { stageAndArchivePrivateArtifact } from '@/lib/scan-ingest/privateArtifact'
import { ScanFileValidationError } from '@/lib/scan-ingest/scanFile'

export const runtime = 'nodejs'

export async function PUT(req: NextRequest, props: { params: Promise<{ readingId: string }> }) {
  const { readingId: readingParam } = await props.params
  const readingId = Number(readingParam)
  const attemptId = Number(req.nextUrl.searchParams.get('attemptId'))
  if (!Number.isFinite(readingId) || !Number.isFinite(attemptId)) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  const bytes = Buffer.from(await req.arrayBuffer())
  if (!verifyN8nScanRequest({ method: req.method, pathAndQuery: `${req.nextUrl.pathname}${req.nextUrl.search}`, body: bytes, timestamp: req.headers.get('x-provatri-timestamp'), signature: req.headers.get('x-provatri-signature') })) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  const reading = await db.query.examScanReadings.findFirst({ where: eq(examScanReadings.id, readingId) })
  const page = reading ? await db.query.examScanPages.findFirst({ where: eq(examScanPages.id, reading.pageId) }) : null
  const attempt = await db.query.examScanProcessingAttempts.findFirst({ where: and(eq(examScanProcessingAttempts.id, attemptId), eq(examScanProcessingAttempts.uploadId, page?.uploadId ?? -1)) })
  const upload = page ? await db.query.examScanUploads.findFirst({ where: and(eq(examScanUploads.id, page.uploadId), eq(examScanUploads.status, 'archived')) }) : null
  if (!reading || !page || !attempt || !upload) return NextResponse.json({ error: 'Recorte não corresponde a uma tentativa arquivada.' }, { status: 409 })
  try {
    const artifact = await stageAndArchivePrivateArtifact({
      bytes, examId: upload.examId, uploadId: upload.id, artifact: 'reading_crop', artifactId: reading.id,
      saveStagingKey: async (key) => { await db.update(examScanReadings).set({ cropStagingObjectKey: key, cropArchiveErrorCode: null, updatedAt: new Date() }).where(eq(examScanReadings.id, reading.id)) },
      saveArchived: async (result, inspection) => { await db.update(examScanReadings).set({ cropDriveFileId: result.driveFileId, cropVerifiedSha256: result.verifiedSha256, cropMimeType: inspection.mimeType, cropStagingObjectKey: null, cropArchivedAt: new Date(), cropArchiveErrorCode: null, updatedAt: new Date() }).where(eq(examScanReadings.id, reading.id)) },
      saveFailure: async () => { await db.update(examScanReadings).set({ cropArchiveErrorCode: 'ARCHIVE_FAILED', updatedAt: new Date() }).where(eq(examScanReadings.id, reading.id)) },
    })
    return NextResponse.json({ stored: true, sha256: artifact.verifiedSha256 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof ScanFileValidationError ? error.message : 'Não foi possível arquivar o recorte privado.' }, { status: 502 })
  }
}
