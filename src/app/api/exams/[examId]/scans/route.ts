import { unlink } from 'fs/promises'
import { asc, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examScanAuditEvents, examScanUploads } from '@/db/schema'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import { archivePrivateScan } from '@/lib/scan-ingest/privateDriveArchive'
import { enqueueLocalScanProcessing } from '@/lib/scan-ingest/enqueueLocalScan'
import { inspectScanFile, newStagingObjectKey, resolveStagingPath, ScanFileValidationError, ScanStagingConfigurationError, stageScanFile } from '@/lib/scan-ingest/scanFile'

export const runtime = 'nodejs'

// Scans podem ser enviados para qualquer prova já aprovada — não é necessário
// aguardar o status "aplicado", que foi removido do fluxo obrigatório.
const SCAN_ALLOWED_STATUSES = ['aprovado', 'impresso', 'aplicado', 'corrigido'] as const

async function removeStagingFile(objectKey: string) {
  try {
    await unlink(resolveStagingPath(objectKey))
    return true
  } catch {
    return false
  }
}

export async function GET(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const result = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in result) return result.error

  const uploads = await db.query.examScanUploads.findMany({
    where: eq(examScanUploads.examId, examId),
    orderBy: [asc(examScanUploads.createdAt)],
    columns: {
      id: true,
      mimeType: true,
      byteSize: true,
      sha256: true,
      status: true,
      archivedAt: true,
      archiveErrorCode: true,
      technicalMetadata: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  return NextResponse.json({ uploads })
}

export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const result = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in result) return result.error
  const { exam, currentUser } = result
  if (!SCAN_ALLOWED_STATUSES.includes(exam.status as (typeof SCAN_ALLOWED_STATUSES)[number])) {
    return NextResponse.json({ error: 'Os scans só podem ser importados após a prova ser aprovada.' }, { status: 409 })
  }
  let scan: FormDataEntryValue | null
  try {
    scan = (await req.formData()).get('scan')
  } catch {
    return NextResponse.json({ error: 'Envie o arquivo no campo scan como multipart/form-data.' }, { status: 400 })
  }
  if (!(scan instanceof File)) return NextResponse.json({ error: 'Envie o arquivo no campo scan como multipart/form-data.' }, { status: 400 })

  let bytes: Buffer
  let inspection
  try {
    bytes = Buffer.from(await scan.arrayBuffer())
    inspection = await inspectScanFile(bytes)
  } catch (error) {
    console.error('Falha ao validar o arquivo de scan:', error)
    const message = error instanceof ScanFileValidationError ? error.message : 'Não foi possível validar o arquivo do scan.'
    return NextResponse.json({ error: 'invalid_scan_file', message }, { status: 400 })
  }

  const stagingObjectKey = newStagingObjectKey(inspection.extension)
  try {
    await stageScanFile(bytes, stagingObjectKey)
  } catch (error) {
    console.error('Falha ao preparar staging do scan:', error)
    const message = error instanceof ScanStagingConfigurationError ? error.message : 'Não foi possível preparar o staging privado do scan.'
    return NextResponse.json({ error: 'scan_staging_error', message }, { status: 503 })
  }

  let upload
  try {
    ;[upload] = await db
      .insert(examScanUploads)
      .values({
        examId,
        mimeType: inspection.mimeType,
        byteSize: inspection.byteSize,
        sha256: inspection.sha256,
        stagingObjectKey,
        technicalMetadata: inspection.technicalMetadata,
        createdBy: currentUser.id,
      })
      .returning()
    await db.insert(examScanAuditEvents).values({
      examId,
      uploadId: upload.id,
      action: 'upload_received',
      actorId: currentUser.id,
      metadata: { mimeType: inspection.mimeType, byteSize: inspection.byteSize },
    })
  } catch {
    await removeStagingFile(stagingObjectKey)
    return NextResponse.json({ error: 'scan_persistence_error', message: 'Não foi possível registrar o upload do scan.' }, { status: 500 })
  }

  try {
    const archived = await archivePrivateScan({  uploadId: upload.id, examId, stagingObjectKey, inspection })
    const stagingRemoved = await removeStagingFile(stagingObjectKey)
    if (!stagingRemoved) {
      await db.transaction(async (tx) => {
        await tx.update(examScanUploads).set({
          status: 'archive_failed',
          driveFileId: archived.driveFileId,
          driveVerifiedSha256: archived.verifiedSha256,
          archiveErrorCode: 'STAGING_PURGE_FAILED',
          updatedAt: new Date(),
        }).where(eq(examScanUploads.id, upload.id))
        await tx.insert(examScanAuditEvents).values({ examId, uploadId: upload.id, action: 'staging_purge_failed', actorId: currentUser.id })
      })
      return NextResponse.json({ upload: { id: upload.id, status: 'archive_failed', sha256: inspection.sha256 } }, { status: 202 })
    }

    const archivedAt = new Date()
    await db.transaction(async (tx) => {
      await tx.update(examScanUploads).set({
        status: 'archived',
        stagingObjectKey: null,
        driveFileId: archived.driveFileId,
        driveVerifiedSha256: archived.verifiedSha256,
        archivedAt,
        archiveErrorCode: null,
        updatedAt: archivedAt,
      }).where(eq(examScanUploads.id, upload.id))
      await tx.insert(examScanAuditEvents).values({
        examId,
        uploadId: upload.id,
        action: 'archived_private_drive',
        actorId: currentUser.id,
        metadata: { byteSize: inspection.byteSize },
      })
    })
    // Queue immediately after durable archival. The scan does not depend on a
    // second browser action, so closing the tab cannot strand an upload.
    let attempt
    try {
      attempt = await enqueueLocalScanProcessing({
        examId,
        uploadId: upload.id,
        requestedBy: currentUser.id,
        generationPayload: exam.generationPayload,
      })
    } catch (error) {
      console.error('Falha ao enfileirar processamento de scan:', error)
      const message = error instanceof Error ? error.message : 'O arquivo foi arquivado, mas nao entrou na fila de processamento.'
      return NextResponse.json({
        upload: { id: upload.id, status: 'archived', sha256: inspection.sha256, archivedAt },
        error: 'scan_queue_error',
        message,
      }, { status: 503 })
    }
    return NextResponse.json({
      upload: { id: upload.id, status: 'archived', sha256: inspection.sha256, archivedAt },
      attempt,
    }, { status: 201 })
  } catch {
    await db.transaction(async (tx) => {
      await tx.update(examScanUploads).set({ status: 'archive_failed', archiveErrorCode: 'DRIVE_ARCHIVE_FAILED', updatedAt: new Date() }).where(eq(examScanUploads.id, upload.id))
      await tx.insert(examScanAuditEvents).values({ examId, uploadId: upload.id, action: 'archive_failed', actorId: currentUser.id })
    })
    // O staging fica privado e registrado para uma futura tentativa de
    // recuperação; nenhum workflow n8n é chamado nesse estado.
    return NextResponse.json({ upload: { id: upload.id, status: 'archive_failed', sha256: inspection.sha256 } }, { status: 202 })
  }
}
