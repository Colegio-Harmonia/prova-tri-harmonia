import { and, eq, inArray } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examScanAuditEvents, examScanPages, examScanProcessingAttempts, examScanReadings, examScanUploads, examSheetAssignments } from '@/db/schema'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import { enqueueLocalScanProcessing } from '@/lib/scan-ingest/enqueueLocalScan'

/** Move somente um lote homogêneo para a prova identificada pelo QR. Lotes
 * com folhas de provas diferentes ficam bloqueados para que nunca exista uma
 * associação automática ambígua. */
export async function POST(_req: NextRequest, props: { params: Promise<{ examId: string; uploadId: string }> }) {
  const { examId: rawExamId, uploadId: rawUploadId } = await props.params
  const examId = Number(rawExamId); const uploadId = Number(rawUploadId)
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!Number.isFinite(examId) || !Number.isFinite(uploadId)) return NextResponse.json({ error: 'ID inválido.' }, { status: 400 })
  const source = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in source) return source.error
  const upload = await db.query.examScanUploads.findFirst({ where: and(eq(examScanUploads.id, uploadId), eq(examScanUploads.examId, examId)) })
  const pages = await db.query.examScanPages.findMany({ where: eq(examScanPages.uploadId, uploadId) })
  const assignmentIds = [...new Set(pages.map((page) => page.sheetAssignmentId).filter((id): id is number => id !== null))]
  const assignments = assignmentIds.length ? await db.query.examSheetAssignments.findMany({ where: inArray(examSheetAssignments.id, assignmentIds) }) : []
  const targetExamIds = [...new Set(assignments.map((assignment) => assignment.examId))]
  if (!upload || !pages.length || targetExamIds.length !== 1 || targetExamIds[0] === examId || pages.some((page) => page.exceptionCode !== 'SCAN_BELONGS_TO_ANOTHER_EXAM')) {
    return NextResponse.json({ error: 'Só é possível mover um envio cujas páginas pertençam todas à mesma outra prova.' }, { status: 409 })
  }
  const targetExamId = targetExamIds[0]
  const target = await loadExamAndAuthorize(targetExamId, session.user.email)
  if ('error' in target) return NextResponse.json({ error: 'Você não tem acesso à prova identificada pelo QR.' }, { status: 403 })

  await db.transaction(async (tx) => {
    await tx.delete(examScanReadings).where(inArray(examScanReadings.pageId, pages.map((page) => page.id)))
    await tx.delete(examScanProcessingAttempts).where(eq(examScanProcessingAttempts.uploadId, uploadId))
    await tx.update(examScanPages).set({ sheetAssignmentId: null, sheetPageNumber: null, pageType: null, exceptionCode: null, status: 'pending', updatedAt: new Date() }).where(eq(examScanPages.uploadId, uploadId))
    await tx.update(examScanUploads).set({ examId: targetExamId, updatedAt: new Date() }).where(eq(examScanUploads.id, uploadId))
    await tx.insert(examScanAuditEvents).values([
      { examId, uploadId, action: 'scan_moved_to_correct_exam', actorId: source.currentUser.id, metadata: { targetExamId } },
      { examId: targetExamId, uploadId, action: 'scan_received_from_wrong_exam', actorId: source.currentUser.id, metadata: { sourceExamId: examId } },
    ])
  })
  try {
    await enqueueLocalScanProcessing({ examId: targetExamId, uploadId, requestedBy: source.currentUser.id, generationPayload: target.exam.generationPayload })
  } catch (error) {
    return NextResponse.json({ error: `O envio foi movido, mas não entrou na fila da prova correta: ${error instanceof Error ? error.message : 'erro desconhecido'}` }, { status: 503 })
  }
  return NextResponse.json({ ok: true, targetExamId })
}
