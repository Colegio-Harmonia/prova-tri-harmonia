import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examCorrections, examScanPages, examScanReadings, examScanUploads, examSheetAssignments, generationJobs } from '@/db/schema'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import { queueDiscursiveTranscriptions } from '@/lib/scan-ingest/transcriptionQueue'
import { planSheetPages } from '@/lib/scan-sheets/sheetLayout'
import { latestRelevantTranscriptionPages, sheetPageNumberForQuestion, summarizeTranscriptions, type TranscriptionJob, type TranscriptionPage, type TranscriptionReading, type TranscriptionSummary } from '@/lib/scan-ingest/transcriptionStatus'
import { normalizeCorrectionAnswers } from '@/lib/corrections/normalizeCorrectionAnswers'

const bodySchema = z.object({
  correctionId: z.number().int().positive().optional(),
  questionNumbers: z.array(z.number().int().positive()).min(1).max(15).optional(),
})

async function accessForExam(examId: number) {
  const session = await auth()
  if (!session?.user?.email) return { error: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  const access = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in access) return { error: access.error }
  return { access }
}

export async function GET(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const { examId: examParam } = await props.params
  const examId = Number(examParam)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const context = await accessForExam(examId)
  if ('error' in context) return context.error

  const plan = planSheetPages((context.access.exam.generationPayload as ExamGenerationResult).questions)
  const discursiveQuestionNumbers = new Set(plan.filter((page) => page.kind === 'discursive').flatMap((page) => page.questions.map((question) => question.number)))
  const assignments = await db.query.examSheetAssignments.findMany({ where: eq(examSheetAssignments.examId, examId), columns: { id: true, examCorrectionId: true } })
  const correctionIds = assignments.map((assignment) => assignment.examCorrectionId)
  const corrections = correctionIds.length
    ? await db.query.examCorrections.findMany({ where: inArray(examCorrections.id, correctionIds), columns: { id: true, answers: true } })
    : []
  const pages = assignments.length
    ? await db.select({
        id: examScanPages.id,
        sheetAssignmentId: examScanPages.sheetAssignmentId,
        sheetPageNumber: examScanPages.sheetPageNumber,
        status: examScanPages.status,
        canonicalDriveFileId: examScanPages.canonicalDriveFileId,
        exceptionCode: examScanPages.exceptionCode,
        createdAt: examScanPages.createdAt,
      }).from(examScanPages)
        .innerJoin(examScanUploads, eq(examScanPages.uploadId, examScanUploads.id))
        .where(and(inArray(examScanPages.sheetAssignmentId, assignments.map((assignment) => assignment.id)), eq(examScanUploads.examId, examId), eq(examScanPages.pageType, 'discursive'), sql`${examScanPages.exceptionCode} IS DISTINCT FROM 'SCAN_BELONGS_TO_ANOTHER_EXAM'`))
        .orderBy(sql`CASE WHEN ${examScanPages.status} = 'processed' AND ${examScanPages.exceptionCode} IS NULL THEN 0 ELSE 1 END`, desc(examScanPages.createdAt))
    : []
  const currentPages = latestRelevantTranscriptionPages(pages, (page) => page.sheetAssignmentId !== null && page.sheetPageNumber !== null ? `${page.sheetAssignmentId}:${page.sheetPageNumber}` : null)
  const latestPageByAssignmentAndNumber = new Map(currentPages.map((page) => [`${page.sheetAssignmentId}:${page.sheetPageNumber}`, page]))
  const pageIds = currentPages.map((page) => page.id)
  const readings = pageIds.length
    ? await db.query.examScanReadings.findMany({ where: and(inArray(examScanReadings.pageId, pageIds), eq(examScanReadings.kind, 'discursive')) })
    : []
  const activeJobRows = await db.query.generationJobs.findMany({
    where: and(eq(generationJobs.jobType, 'transcrever_scan'), inArray(generationJobs.status, ['pendente', 'gerando'])),
    columns: { payload: true, status: true, availableAt: true },
  })
  const activeJobs: TranscriptionJob[] = []
  for (const row of activeJobRows) {
    const payload = row.payload as { examId?: number; pageId?: number; questionNumbers?: number[] } | null
    if (payload?.examId !== examId || !Number.isInteger(payload.pageId)) continue
    const questionNumbers = Array.isArray(payload.questionNumbers) ? payload.questionNumbers.filter((value): value is number => Number.isInteger(value)) : []
    activeJobs.push({ pageId: payload.pageId!, questionNumbers, status: row.status as 'pendente' | 'gerando', availableAt: row.availableAt })
  }
  const readingsByPage = new Map<number, TranscriptionReading[]>([])
  for (const reading of readings) readingsByPage.set(reading.pageId, [...(readingsByPage.get(reading.pageId) ?? []), reading])
  const assignmentsByCorrection = new Map(assignments.map((assignment) => [assignment.examCorrectionId, assignment]))
  const summaries: Array<{ correctionId: number; summary: TranscriptionSummary }> = []
  for (const correction of corrections) {
    const assignment = assignmentsByCorrection.get(correction.id)
    const pageForQuestion = new Map<number, TranscriptionPage | undefined>()
    for (const questionNumber of discursiveQuestionNumbers) {
      const sheetPageNumber = sheetPageNumberForQuestion(plan, questionNumber)
      pageForQuestion.set(questionNumber, assignment && sheetPageNumber ? latestPageByAssignmentAndNumber.get(`${assignment.id}:${sheetPageNumber}`) : undefined)
    }
    const summary = summarizeTranscriptions({
      answers: normalizeCorrectionAnswers(correction.answers),
      discursiveQuestionNumbers,
      pages: currentPages as TranscriptionPage[],
      readings: pageForQuestion.size ? [...new Set([...pageForQuestion.values()].filter(Boolean).flatMap((page) => readingsByPage.get(page!.id) ?? []))] : [],
      pageForQuestion,
      activeJobs,
    })
    summaries.push({ correctionId: correction.id, summary })
  }
  const aggregate = summaries.reduce((total, item) => {
    for (const key of ['total', 'completed', 'queued', 'processing', 'deferred', 'needsReview', 'failed', 'active'] as const) total[key] += item.summary[key]
    if (item.summary.lastUpdatedAt && (!total.lastUpdatedAt || item.summary.lastUpdatedAt > total.lastUpdatedAt)) total.lastUpdatedAt = item.summary.lastUpdatedAt
    return total
  }, { total: 0, completed: 0, queued: 0, processing: 0, deferred: 0, needsReview: 0, failed: 0, active: 0, lastUpdatedAt: null as string | null })
  return NextResponse.json({
    ...aggregate,
    ready: aggregate.completed,
    canApprove: aggregate.active === 0 && aggregate.needsReview === 0,
    corrections: summaries,
  })
}

export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const { examId: examParam } = await props.params
  const examId = Number(examParam)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const context = await accessForExam(examId)
  if ('error' in context) return context.error
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos para a fila de transcrição.' }, { status: 400 })
  if (parsed.data.correctionId) {
    const assignment = await db.query.examSheetAssignments.findFirst({ where: and(eq(examSheetAssignments.examId, examId), eq(examSheetAssignments.examCorrectionId, parsed.data.correctionId)) })
    if (!assignment) return NextResponse.json({ error: 'A correção não possui folha individual desta prova.' }, { status: 409 })
  }
  const result = await queueDiscursiveTranscriptions({
    examId,
    requestedBy: context.access.currentUser.id,
    correctionId: parsed.data.correctionId,
    questionNumbers: parsed.data.questionNumbers,
  })
  return NextResponse.json(result, { status: 202 })
}
