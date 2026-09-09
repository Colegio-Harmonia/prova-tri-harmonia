import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examCorrections, examScanPages, examScanReadings, examScanUploads, examSheetAssignments } from '@/db/schema'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import type { CorrectionAnswer } from '@/types/correction'

function correctionAnswers(value: unknown): CorrectionAnswer[] {
  return Array.isArray(value) ? value as CorrectionAnswer[] : []
}

export async function GET(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const result = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in result) return result.error

  const pages = await db
    .select({
      pageId: examScanPages.id,
      uploadId: examScanPages.uploadId,
      sheetAssignmentId: examScanPages.sheetAssignmentId,
      pageIndex: examScanPages.pageIndex,
      status: examScanPages.status,
      sheetPageNumber: examScanPages.sheetPageNumber,
      pageType: examScanPages.pageType,
      qualityScore: examScanPages.qualityScore,
      exceptionCode: examScanPages.exceptionCode,
      imageAvailable: examScanPages.canonicalDriveFileId,
      studentName: examSheetAssignments.studentNameSnapshot,
      correctionId: examSheetAssignments.examCorrectionId,
      assignmentExamId: examSheetAssignments.examId,
      expectedPageCount: examSheetAssignments.pageCount,
      createdAt: examScanPages.createdAt,
    })
    .from(examScanPages)
    .innerJoin(examScanUploads, eq(examScanPages.uploadId, examScanUploads.id))
    .leftJoin(examSheetAssignments, eq(examScanPages.sheetAssignmentId, examSheetAssignments.id))
    .where(eq(examScanUploads.examId, examId))
    .orderBy(asc(examScanPages.createdAt), asc(examScanPages.pageIndex))

  const pageIds = pages.map((page) => page.pageId)
  const readings = pageIds.length > 0
    ? await db.query.examScanReadings.findMany({ where: inArray(examScanReadings.pageId, pageIds), orderBy: [asc(examScanReadings.questionNumber)] })
    : []
  const readingsByPageId = new Map<number, typeof readings>()
  for (const reading of readings) readingsByPageId.set(reading.pageId, [...(readingsByPageId.get(reading.pageId) ?? []), reading])

  const corrections = await db.query.examCorrections.findMany({ where: eq(examCorrections.examId, examId), columns: { id: true, studentName: true, answers: true } })
  const expectedByCorrection = new Map(corrections.map((correction) => [
    correction.id,
    new Map(correctionAnswers(correction.answers).map((answer) => [answer.questionNumber, answer.correctLetter ?? null])),
  ]))
  const duplicateUploadByPageId = new Map<number, number>()
  for (const page of pages.filter((page) => page.exceptionCode === 'DUPLICATE_SHEET_SCAN' && page.sheetAssignmentId)) {
    const previous = await db.query.examScanPages.findFirst({
      where: and(
        eq(examScanPages.sheetAssignmentId, page.sheetAssignmentId!),
        sql`${examScanPages.uploadId} <> ${page.uploadId}`,
        sql`${examScanPages.exceptionCode} IS DISTINCT FROM 'SUPERSEDED_BY_NEW_SCAN'`,
      ),
      orderBy: [asc(examScanPages.createdAt)],
      columns: { uploadId: true },
    })
    if (previous) duplicateUploadByPageId.set(page.pageId, previous.uploadId)
  }
  // Páginas substituídas permanecem no banco apenas para auditoria. Elas não
  // representam um envio pendente e nunca devem voltar para a fila da UI.
  const serializedPages = pages.filter((page) => page.exceptionCode !== 'SUPERSEDED_BY_NEW_SCAN').map((page) => ({
      ...page,
      duplicateUploadId: duplicateUploadByPageId.get(page.pageId) ?? null,
      imageAvailable: Boolean(page.imageAvailable),
      readings: (readingsByPageId.get(page.pageId) ?? []).map((reading) => ({
        ...reading,
        expectedLetter: page.correctionId ? (expectedByCorrection.get(page.correctionId)?.get(reading.questionNumber) ?? null) : null,
        cropAvailable: Boolean(reading.cropDriveFileId),
        cropDriveFileId: undefined,
      })),
    }))
  return NextResponse.json({ pages: serializedPages, corrections: corrections.map(({ id, studentName }) => ({ id, studentName })), queue: serializedPages.filter((page) => page.exceptionCode) })
}
