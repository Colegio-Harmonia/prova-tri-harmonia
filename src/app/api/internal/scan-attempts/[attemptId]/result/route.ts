import { createHash } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/client'
import { examScanAuditEvents, examScanPages, examScanProcessingAttempts, examScanReadings, examScanUploads, examSheetAssignments, generatedExams } from '@/db/schema'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { planSheetPages } from '@/lib/scan-sheets/sheetLayout'
import { createPageQrPayload, createSheetTokenDigest, readSheetQrSigningKeys, verifyPageQrPayload } from '@/lib/scan-sheets/sheetQr'
import { verifyN8nScanRequest } from '@/lib/scan-ingest/n8nAuth'
import { workerScanResultSchema, type WorkerScanResult } from '@/lib/scan-ingest/workerResultSchema'

export const runtime = 'nodejs'

function tokenDigest(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function isIssuedToken(params: { assignment: typeof examSheetAssignments.$inferSelect; qr: NonNullable<ReturnType<typeof verifyPageQrPayload>>; signingKeys: ReturnType<typeof readSheetQrSigningKeys> }) {
  const { assignment, qr, signingKeys } = params
  const signingKey = signingKeys.find((key) => key.keyId === qr.keyId)
  if (!signingKey || !assignment.tokenDigest || qr.pageNumber > assignment.pageCount) return false
  const tokens = Array.from({ length: assignment.pageCount }, (_, index) => createPageQrPayload({
    publicId: assignment.publicId,
    pageNumber: index + 1,
    layoutVersion: assignment.layoutVersion,
  }, signingKey))
  return createSheetTokenDigest(tokens) === assignment.tokenDigest
}

function resolvePage(params: {
  page: WorkerScanResult['pages'][number]
  assignmentsByPublicId: Map<string, typeof examSheetAssignments.$inferSelect>
  expectedPageKinds: Array<'objective' | 'discursive'>
  signingKeys: ReturnType<typeof readSheetQrSigningKeys>
}) {
  const { page, assignmentsByPublicId, expectedPageKinds, signingKeys } = params
  if (!page.qrToken) return { status: 'needs_review' as const, exceptionCode: page.exceptionCode ?? 'QR_MISSING', assignment: null, sheetPageNumber: null, pageType: null, qrTokenDigest: null }
  const qr = verifyPageQrPayload(page.qrToken, signingKeys)
  if (!qr) return { status: 'needs_review' as const, exceptionCode: page.exceptionCode ?? 'QR_INVALID', assignment: null, sheetPageNumber: null, pageType: null, qrTokenDigest: tokenDigest(page.qrToken) }
  const assignment = assignmentsByPublicId.get(qr.publicId)
  if (!assignment || assignment.status !== 'emitida' || assignment.layoutVersion !== qr.layoutVersion || !isIssuedToken({ assignment, qr, signingKeys })) {
    return { status: 'needs_review' as const, exceptionCode: page.exceptionCode ?? 'SHEET_NOT_EMITTED', assignment: null, sheetPageNumber: qr.pageNumber, pageType: null, qrTokenDigest: tokenDigest(page.qrToken) }
  }
  const expectedPageType = expectedPageKinds[qr.pageNumber - 1]
  if (!expectedPageType || page.pageType !== expectedPageType) {
    return { status: 'needs_review' as const, exceptionCode: page.exceptionCode ?? 'PAGE_TYPE_MISMATCH', assignment, sheetPageNumber: qr.pageNumber, pageType: expectedPageType, qrTokenDigest: tokenDigest(page.qrToken) }
  }
  if (page.qualityScore !== null && page.qualityScore !== undefined && page.qualityScore < 0.65) {
    return { status: 'needs_review' as const, exceptionCode: page.exceptionCode ?? 'LOW_QUALITY', assignment, sheetPageNumber: qr.pageNumber, pageType: expectedPageType, qrTokenDigest: tokenDigest(page.qrToken) }
  }
  return { status: page.exceptionCode ? 'needs_review' as const : 'processed' as const, exceptionCode: page.exceptionCode ?? null, assignment, sheetPageNumber: qr.pageNumber, pageType: expectedPageType, qrTokenDigest: tokenDigest(page.qrToken) }
}

export async function POST(req: NextRequest, props: { params: Promise<{ attemptId: string }> }) {
  const params = await props.params
  const attemptId = Number(params.attemptId)
  if (!Number.isFinite(attemptId)) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  const rawBody = await req.text()
  const pathAndQuery = `${req.nextUrl.pathname}${req.nextUrl.search}`
  const authenticated = verifyN8nScanRequest({
    method: req.method,
    pathAndQuery,
    body: rawBody,
    timestamp: req.headers.get('x-provatri-timestamp'),
    signature: req.headers.get('x-provatri-signature'),
  })
  if (!authenticated) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  let parsedBody: WorkerScanResult
  try {
    parsedBody = workerScanResultSchema.parse(JSON.parse(rawBody))
  } catch {
    return NextResponse.json({ error: 'Resultado de leitura inválido.' }, { status: 400 })
  }

  let signingKeys: ReturnType<typeof readSheetQrSigningKeys>
  try {
    signingKeys = readSheetQrSigningKeys()
  } catch {
    return NextResponse.json({ error: 'Configuração QR indisponível.' }, { status: 503 })
  }

  const attempt = await db.query.examScanProcessingAttempts.findFirst({ where: eq(examScanProcessingAttempts.id, attemptId) })
  if (!attempt) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  if (!['queued', 'delivered', 'completed'].includes(attempt.status)) return NextResponse.json({ error: 'Tentativa não aceita resultado neste estado.' }, { status: 409 })
  const upload = await db.query.examScanUploads.findFirst({ where: and(eq(examScanUploads.id, attempt.uploadId), eq(examScanUploads.status, 'archived')) })
  if (!upload || upload.sha256 !== parsedBody.uploadSha256) return NextResponse.json({ error: 'O resultado não corresponde ao arquivo arquivado.' }, { status: 409 })
  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, upload.examId) })
  if (!exam) return NextResponse.json({ error: 'Prova não encontrada.' }, { status: 404 })

  const [pages, assignments] = await Promise.all([
    db.query.examScanPages.findMany({ where: eq(examScanPages.uploadId, upload.id) }),
    db.query.examSheetAssignments.findMany({ where: eq(examSheetAssignments.examId, exam.id) }),
  ])
  if (pages.length === 0 || pages.length !== parsedBody.pages.length || new Set(parsedBody.pages.map((page) => page.pageIndex)).size !== pages.length || !pages.every((page) => parsedBody.pages.some((resultPage) => resultPage.pageIndex === page.pageIndex))) {
    return NextResponse.json({ error: 'O resultado precisa cobrir exatamente as páginas catalogadas do upload.' }, { status: 409 })
  }

  let expectedPageKinds: Array<'objective' | 'discursive'>
  let expectedReadingsBySheetPage: Map<number, Map<number, 'objective' | 'discursive'>>
  try {
    const payload = exam.generationPayload as ExamGenerationResult
    const plannedPages = planSheetPages(payload.questions)
    expectedPageKinds = plannedPages.map((page) => page.kind)
    expectedReadingsBySheetPage = new Map(plannedPages.map((page, index) => [
      index + 1,
      new Map(page.questions.map((question) => [question.number, question.type === 'objetiva' ? 'objective' as const : 'discursive' as const])),
    ]))
  } catch {
    return NextResponse.json({ error: 'A prova não possui layout PTR1 compatível para receber leituras.' }, { status: 409 })
  }

  const pagesByIndex = new Map(pages.map((page) => [page.pageIndex, page]))
  const assignmentsByPublicId = new Map(assignments.map((assignment) => [assignment.publicId, assignment]))
  let processedPages = 0
  let reviewPages = 0
  const readingRefs: Array<{ id: number; pageId: number; pageIndex: number; questionNumber: number }> = []

  await db.transaction(async (tx) => {
    for (const resultPage of parsedBody.pages) {
      const page = pagesByIndex.get(resultPage.pageIndex)!
      const resolved = resolvePage({ page: resultPage, assignmentsByPublicId, expectedPageKinds, signingKeys })
      const expectedReadings = resolved.sheetPageNumber ? expectedReadingsBySheetPage.get(resolved.sheetPageNumber) : null
      const hasInvalidReading = resultPage.readings.some((reading) => reading.exceptionCode || !expectedReadings || expectedReadings.get(reading.questionNumber) !== reading.kind)
      const isIncomplete = Boolean(expectedReadings && [...expectedReadings.keys()].some((number) => !resultPage.readings.some((reading) => reading.questionNumber === number)))
      const hasReadingException = hasInvalidReading || isIncomplete
      const finalStatus = resolved.status === 'processed' && !hasReadingException ? 'processed' as const : 'needs_review' as const
      const finalException = resolved.exceptionCode ?? (isIncomplete ? 'READING_INCOMPLETE' : hasInvalidReading ? 'READING_REVIEW_REQUIRED' : null)
      if (finalStatus === 'processed') processedPages += 1
      else reviewPages += 1

      await tx.update(examScanPages).set({
        sheetAssignmentId: resolved.assignment?.id ?? null,
        sheetPageNumber: resolved.sheetPageNumber,
        pageType: resolved.pageType,
        qrTokenDigest: resolved.qrTokenDigest,
        qualityScore: resultPage.qualityScore ?? null,
        status: finalStatus,
        exceptionCode: finalException,
        updatedAt: new Date(),
      }).where(eq(examScanPages.id, page.id))

      for (const reading of resultPage.readings) {
        const readingException = reading.exceptionCode ?? (!expectedReadings || expectedReadings.get(reading.questionNumber) !== reading.kind ? 'QUESTION_KIND_MISMATCH' : null)
        const existing = await tx.query.examScanReadings.findFirst({
          where: and(eq(examScanReadings.pageId, page.id), eq(examScanReadings.questionNumber, reading.questionNumber)),
        })
        if (existing?.reviewStatus && existing.reviewStatus !== 'pending') {
          readingRefs.push({ id: existing.id, pageId: page.id, pageIndex: page.pageIndex, questionNumber: reading.questionNumber })
          continue
        }
        const values = {
          kind: reading.kind,
          suggestedLetter: reading.suggestedLetter ?? null,
          suggestedTranscription: reading.suggestedTranscription ?? null,
          confidence: reading.confidence ?? null,
          exceptionCode: readingException,
          modelReference: reading.modelReference ?? null,
          updatedAt: new Date(),
        }
        if (existing) {
          await tx.update(examScanReadings).set(values).where(eq(examScanReadings.id, existing.id))
          readingRefs.push({ id: existing.id, pageId: page.id, pageIndex: page.pageIndex, questionNumber: reading.questionNumber })
        } else {
          const [created] = await tx.insert(examScanReadings).values({ pageId: page.id, questionNumber: reading.questionNumber, ...values }).returning({ id: examScanReadings.id })
          readingRefs.push({ id: created.id, pageId: page.id, pageIndex: page.pageIndex, questionNumber: reading.questionNumber })
        }
      }
    }

    await tx.update(examScanProcessingAttempts).set({ status: 'completed', updatedAt: new Date() }).where(eq(examScanProcessingAttempts.id, attempt.id))
    await tx.insert(examScanAuditEvents).values({
      examId: exam.id,
      uploadId: upload.id,
      action: 'n8n_result_received',
      metadata: { attemptId, processedPages, reviewPages },
    })
  })

  // IDs opacos para que o worker anexe os recortes à leitura correta. Não há
  // Drive ID, URL, QR, aluno ou transcrição nessa resposta.
  return NextResponse.json({ accepted: true, processedPages, reviewPages, readingRefs })
}
