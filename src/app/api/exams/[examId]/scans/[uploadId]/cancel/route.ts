import { and, eq, inArray, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examCorrections, examScanAuditEvents, examScanPages, examScanProcessingAttempts, examScanReadings, examScanUploads, examSheetAssignments, generationJobs, pedagogicalClassificationAudit, pedagogicalClassifications } from '@/db/schema'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import { buildEmptyAnswers } from '@/lib/corrections/buildEmptyAnswers'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

/** Descarta um envio inteiro. Não remove uma correção já aprovada, pois ela
 * pode representar outro envio válido e já ter sido contabilizada. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ examId: string; uploadId: string }> }) {
  const { examId: rawExamId, uploadId: rawUploadId } = await props.params
  const examId = Number(rawExamId); const uploadId = Number(rawUploadId)
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!Number.isFinite(examId) || !Number.isFinite(uploadId)) return NextResponse.json({ error: 'ID inválido.' }, { status: 400 })
  const access = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in access) return access.error
  const upload = await db.query.examScanUploads.findFirst({ where: and(eq(examScanUploads.id, uploadId), eq(examScanUploads.examId, examId)) })
  if (!upload) return NextResponse.json({ error: 'Processamento não encontrado.' }, { status: 404 })
  const pages = await db.query.examScanPages.findMany({ where: eq(examScanPages.uploadId, uploadId), columns: { id: true, sheetAssignmentId: true } })
  const assignmentIds = pages.map((page) => page.sheetAssignmentId).filter((id): id is number => id !== null)
  const pageIds = pages.map((page) => page.id)
  await db.transaction(async (tx) => {
    if (pageIds.length) await tx.delete(examScanReadings).where(inArray(examScanReadings.pageId, pageIds))
    // Jobs pendentes não devem sobreviver a um cancelamento. Um worker que
    // já esteja em execução falhará de modo inofensivo ao não achar a página.
    await tx.execute(sql`DELETE FROM generation_jobs WHERE payload ->> 'uploadId' = ${String(uploadId)} AND payload ->> 'examId' = ${String(examId)}`)
    if (pageIds.length) {
      await tx.execute(sql`DELETE FROM generation_jobs WHERE job_type = 'transcrever_scan' AND (payload ->> 'pageId')::int IN (${sql.join(pageIds.map((pageId) => sql`${pageId}`), sql`, `)})`)
    }
    await tx.delete(examScanAuditEvents).where(eq(examScanAuditEvents.uploadId, uploadId))
    await tx.delete(examScanPages).where(eq(examScanPages.uploadId, uploadId))
    await tx.delete(examScanProcessingAttempts).where(eq(examScanProcessingAttempts.uploadId, uploadId))
    await tx.delete(examScanUploads).where(eq(examScanUploads.id, uploadId))
    if (assignmentIds.length) {
      const assignments = await tx.query.examSheetAssignments.findMany({ where: inArray(examSheetAssignments.id, assignmentIds), columns: { id: true, examCorrectionId: true } })
      const correctionIds = assignments.map((assignment) => assignment.examCorrectionId)
      if (!correctionIds.length) return
      const classifications = await tx.query.pedagogicalClassifications.findMany({
        where: and(eq(pedagogicalClassifications.classifiableType, 'exam_correction_answer'), inArray(pedagogicalClassifications.classifiableId, correctionIds)),
        columns: { id: true },
      })
      if (classifications.length) await tx.delete(pedagogicalClassificationAudit).where(inArray(pedagogicalClassificationAudit.classificationId, classifications.map((item) => item.id)))
      await tx.delete(pedagogicalClassifications).where(and(eq(pedagogicalClassifications.classifiableType, 'exam_correction_answer'), inArray(pedagogicalClassifications.classifiableId, correctionIds)))
      // A atribuição e seu QR representam a identidade da folha física. Eles
      // precisam sobreviver ao descarte para que a mesma folha possa ser
      // escaneada novamente. O que é removido é somente o resultado daquela
      // tentativa: respostas, nota oficial e classificações derivadas.
      await tx.update(examCorrections).set({
        answers: buildEmptyAnswers(access.exam.generationPayload as ExamGenerationResult),
        scoreResult: null,
        gradeReturnedAt: null,
        status: 'pendente',
        updatedAt: new Date(),
      }).where(inArray(examCorrections.id, correctionIds))
    }
  })
  return NextResponse.json({ ok: true, uploadId })
}
