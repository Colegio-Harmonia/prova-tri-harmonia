import { and, desc, eq, inArray } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examCorrections, examScanAuditEvents, examScanPages, examScanReadings, examScanUploads, examSheetAssignments } from '@/db/schema'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import { cropDiscursiveAnswer, DiscursiveOcrError, transcribeDiscursiveAnswer } from '@/lib/scan-ingest/discursiveOcr'
import { stageAndArchivePrivateArtifact } from '@/lib/scan-ingest/privateArtifact'
import { downloadPrivateScanBytes } from '@/lib/scan-ingest/privateScanContent'
import { planSheetPages } from '@/lib/scan-sheets/sheetLayout'
import type { CorrectionAnswer } from '@/types/correction'

const ocrSchema = z.object({ questionNumber: z.number().int().positive() })

type Access = Awaited<ReturnType<typeof loadExamAndAuthorize>>
type AuthorizedAccess = Exclude<Access, { error: NextResponse }>

async function loadCorrection(access: AuthorizedAccess, correctionId: number) {
  return db.query.examCorrections.findFirst({ where: and(eq(examCorrections.id, correctionId), eq(examCorrections.examId, access.exam.id)) })
}

function sheetPagePlan(exam: AuthorizedAccess['exam']) {
  const pages = planSheetPages((exam.generationPayload as ExamGenerationResult).questions)
  const byQuestion = new Map<number, { pageNumber: number; questionIndex: number; questionsOnPage: number; kind: 'objective' | 'discursive' }>()
  pages.forEach((page, pageIndex) => {
    page.questions.forEach((question, questionIndex) => byQuestion.set(question.number, {
      pageNumber: pageIndex + 1,
      questionIndex,
      questionsOnPage: page.questions.length,
      kind: page.kind === 'objective' ? 'objective' : 'discursive',
    }))
  })
  return byQuestion
}

async function evidenceForCorrection(access: AuthorizedAccess, correction: typeof examCorrections.$inferSelect) {
  const assignment = await db.query.examSheetAssignments.findFirst({
    where: and(eq(examSheetAssignments.examId, access.exam.id), eq(examSheetAssignments.examCorrectionId, correction.id)),
  })
  const answers = correction.answers as CorrectionAnswer[]
  const plan = sheetPagePlan(access.exam)
  if (!assignment) {
    return { assignmentFound: false, evidence: answers.map((answer) => ({ questionNumber: answer.questionNumber, kind: answer.type === 'objetiva' ? 'objective' : 'discursive', page: null, reading: null })) }
  }

  const pages = await db
    .select({
      id: examScanPages.id,
      uploadId: examScanPages.uploadId,
      sheetPageNumber: examScanPages.sheetPageNumber,
      pageType: examScanPages.pageType,
      qualityScore: examScanPages.qualityScore,
      status: examScanPages.status,
      exceptionCode: examScanPages.exceptionCode,
      imageAvailable: examScanPages.canonicalDriveFileId,
      createdAt: examScanPages.createdAt,
    })
    .from(examScanPages)
    .innerJoin(examScanUploads, eq(examScanPages.uploadId, examScanUploads.id))
    .where(and(eq(examScanPages.sheetAssignmentId, assignment.id), eq(examScanUploads.examId, access.exam.id)))
    .orderBy(desc(examScanPages.createdAt))
  const latestPageBySheetNumber = new Map<number, (typeof pages)[number]>()
  for (const page of pages) {
    if (page.sheetPageNumber && !latestPageBySheetNumber.has(page.sheetPageNumber)) latestPageBySheetNumber.set(page.sheetPageNumber, page)
  }
  const pageIds = [...latestPageBySheetNumber.values()].map((page) => page.id)
  const readings = pageIds.length
    ? await db.query.examScanReadings.findMany({ where: inArray(examScanReadings.pageId, pageIds) })
    : []
  const readingByPageAndQuestion = new Map(readings.map((reading) => [`${reading.pageId}:${reading.questionNumber}`, reading]))

  return {
    assignmentFound: true,
    scanUploadIds: [...new Set(pages.map((page) => page.uploadId))],
    evidence: answers.map((answer) => {
      const expected = plan.get(answer.questionNumber)
      const page = expected ? latestPageBySheetNumber.get(expected.pageNumber) : undefined
      const reading = page ? readingByPageAndQuestion.get(`${page.id}:${answer.questionNumber}`) : undefined
      return {
        questionNumber: answer.questionNumber,
        kind: expected?.kind ?? (answer.type === 'objetiva' ? 'objective' : 'discursive'),
        page: page ? {
          id: page.id,
          sheetPageNumber: page.sheetPageNumber,
          status: page.status,
          qualityScore: page.qualityScore,
          exceptionCode: page.exceptionCode,
          imageAvailable: Boolean(page.imageAvailable),
        } : null,
        reading: reading ? {
          id: reading.id,
          kind: reading.kind,
          suggestedLetter: reading.suggestedLetter,
          suggestedTranscription: reading.suggestedTranscription,
          confirmedLetter: reading.confirmedLetter,
          confirmedTranscription: reading.confirmedTranscription,
          confidence: reading.confidence,
          exceptionCode: reading.exceptionCode,
          modelReference: reading.modelReference,
          reviewStatus: reading.reviewStatus,
          cropAvailable: Boolean(reading.cropDriveFileId),
        } : null,
      }
    }),
  }
}

async function requestContext(req: NextRequest, params: Promise<{ examId: string; correctionId: string }>) {
  const { examId: examParam, correctionId: correctionParam } = await params
  const examId = Number(examParam); const correctionId = Number(correctionParam)
  const session = await auth()
  if (!session?.user?.email) return { error: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (!Number.isFinite(examId) || !Number.isFinite(correctionId)) return { error: NextResponse.json({ error: 'ID inválido' }, { status: 400 }) }
  const access = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in access) return { error: access.error }
  const correction = await loadCorrection(access, correctionId)
  if (!correction) return { error: NextResponse.json({ error: 'Correção não encontrada.' }, { status: 404 }) }
  return { access, correction }
}

export async function GET(req: NextRequest, props: { params: Promise<{ examId: string; correctionId: string }> }) {
  const context = await requestContext(req, props.params)
  if ('error' in context) return context.error
  return NextResponse.json(await evidenceForCorrection(context.access, context.correction))
}

export async function POST(req: NextRequest, props: { params: Promise<{ examId: string; correctionId: string }> }) {
  const context = await requestContext(req, props.params)
  if ('error' in context) return context.error
  const parsed = ocrSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Questão inválida.' }, { status: 400 })
  const { access, correction } = context
  const answers = correction.answers as CorrectionAnswer[]
  const answer = answers.find((item) => item.questionNumber === parsed.data.questionNumber && item.type === 'descritiva')
  const expected = sheetPagePlan(access.exam).get(parsed.data.questionNumber)
  if (!answer || !expected || expected.kind !== 'discursive') return NextResponse.json({ error: 'A questão não é discursiva nesta prova.' }, { status: 422 })

  const assignment = await db.query.examSheetAssignments.findFirst({ where: and(eq(examSheetAssignments.examId, access.exam.id), eq(examSheetAssignments.examCorrectionId, correction.id)) })
  if (!assignment) return NextResponse.json({ error: 'A folha individual deste aluno ainda não foi emitida.' }, { status: 409 })
  const page = await db
    .select({ id: examScanPages.id, uploadId: examScanPages.uploadId, canonicalDriveFileId: examScanPages.canonicalDriveFileId })
    .from(examScanPages)
    .innerJoin(examScanUploads, eq(examScanPages.uploadId, examScanUploads.id))
    .where(and(eq(examScanPages.sheetAssignmentId, assignment.id), eq(examScanPages.sheetPageNumber, expected.pageNumber), eq(examScanPages.pageType, 'discursive'), eq(examScanUploads.examId, access.exam.id)))
    .orderBy(desc(examScanPages.createdAt))
    .limit(1)
  const scannedPage = page[0]
  if (!scannedPage?.canonicalDriveFileId) return NextResponse.json({ error: 'A página discursiva ainda não foi processada ou sua imagem privada não está disponível.' }, { status: 409 })

  let reading = await db.query.examScanReadings.findFirst({ where: and(eq(examScanReadings.pageId, scannedPage.id), eq(examScanReadings.questionNumber, parsed.data.questionNumber)) })
  if (reading?.reviewStatus === 'accepted') return NextResponse.json({ error: 'Esta transcrição já foi confirmada pelo professor e não deve ser substituída pelo OCR.' }, { status: 409 })
  if (reading?.suggestedTranscription) return NextResponse.json({ reading: { id: reading.id, suggestedTranscription: reading.suggestedTranscription, confidence: reading.confidence, modelReference: reading.modelReference }, alreadyAvailable: true })
  if (!reading) {
    const [created] = await db.insert(examScanReadings).values({ pageId: scannedPage.id, questionNumber: parsed.data.questionNumber, kind: 'discursive', exceptionCode: 'OCR_PROCESSING' }).returning()
    reading = created
  }

  try {
    const canonical = await downloadPrivateScanBytes(scannedPage.canonicalDriveFileId)
    const crop = await cropDiscursiveAnswer({ canonicalImage: canonical, questionIndex: expected.questionIndex, questionsOnPage: expected.questionsOnPage })
    if (!reading.cropDriveFileId) {
      await stageAndArchivePrivateArtifact({
        bytes: crop,
        examId: access.exam.id,
        uploadId: scannedPage.uploadId,
        artifact: 'reading_crop',
        artifactId: reading.id,
        saveStagingKey: async (key) => { await db.update(examScanReadings).set({ cropStagingObjectKey: key, cropArchiveErrorCode: null, updatedAt: new Date() }).where(eq(examScanReadings.id, reading!.id)) },
        saveArchived: async (artifact, inspection) => { await db.update(examScanReadings).set({ cropDriveFileId: artifact.driveFileId, cropVerifiedSha256: artifact.verifiedSha256, cropMimeType: inspection.mimeType, cropStagingObjectKey: null, cropArchivedAt: new Date(), cropArchiveErrorCode: null, updatedAt: new Date() }).where(eq(examScanReadings.id, reading!.id)) },
        saveFailure: async () => { await db.update(examScanReadings).set({ cropArchiveErrorCode: 'ARCHIVE_FAILED', updatedAt: new Date() }).where(eq(examScanReadings.id, reading!.id)) },
      })
    }
    const ocr = await transcribeDiscursiveAnswer({ image: crop, mimeType: 'image/jpeg' })
    const [updated] = await db.update(examScanReadings).set({
      suggestedTranscription: ocr.legible ? ocr.transcription : null,
      confidence: ocr.confidence,
      exceptionCode: ocr.legible ? null : 'OCR_UNREADABLE',
      modelReference: `${ocr.provider}:${ocr.model}`.slice(0, 120),
      updatedAt: new Date(),
    }).where(eq(examScanReadings.id, reading.id)).returning()
    await db.insert(examScanAuditEvents).values({ examId: access.exam.id, uploadId: scannedPage.uploadId, action: 'teacher_discursive_ocr_requested', actorId: access.currentUser.id, metadata: { pageId: scannedPage.id, readingId: reading.id, questionNumber: parsed.data.questionNumber, legible: ocr.legible } })
    return NextResponse.json({ reading: { id: updated.id, suggestedTranscription: updated.suggestedTranscription, confidence: updated.confidence, modelReference: updated.modelReference, reviewStatus: updated.reviewStatus, cropAvailable: Boolean(updated.cropDriveFileId) } })
  } catch (error) {
    const failureCode = error instanceof DiscursiveOcrError ? error.failureCode : 'OCR_FAILED'
    await db.update(examScanReadings).set({ exceptionCode: failureCode.slice(0, 80), updatedAt: new Date() }).where(eq(examScanReadings.id, reading.id))
    const status = error instanceof DiscursiveOcrError && error.failureCode === 'provider_not_configured' ? 503 : 502
    return NextResponse.json({ error: error instanceof DiscursiveOcrError ? error.message : 'Não foi possível preparar a leitura automática desta resposta.' }, { status })
  }
}
