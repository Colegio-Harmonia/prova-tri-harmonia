import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { examCorrections, examScanAuditEvents, examScanPages, examScanReadings, examScanUploads, examSheetAssignments, generatedExams, generationJobs } from '@/db/schema'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { suggestGrade } from '@/lib/gemini/gradeSuggestion'
import { enqueuePontuarProvaJob } from '@/lib/queue/enqueue'
import { cropDiscursiveAnswer, DiscursiveOcrError, transcribeDiscursiveAnswer } from '@/lib/scan-ingest/discursiveOcr'
import { stageAndArchivePrivateArtifact } from '@/lib/scan-ingest/privateArtifact'
import { downloadPrivateScanBytes } from '@/lib/scan-ingest/privateScanContent'
import { planSheetPages } from '@/lib/scan-sheets/sheetLayout'
import type { CorrectionAnswer } from '@/types/correction'

type QuestionPlan = { pageNumber: number; questionIndex: number; questionsOnPage: number }

function discursiveQuestionPlan(exam: typeof generatedExams.$inferSelect) {
  const plan = new Map<number, QuestionPlan>()
  planSheetPages((exam.generationPayload as ExamGenerationResult).questions).forEach((page, pageIndex) => {
    if (page.kind !== 'discursive') return
    page.questions.forEach((question, questionIndex) => plan.set(question.number, {
      pageNumber: pageIndex + 1,
      questionIndex,
      questionsOnPage: page.questions.length,
    }))
  })
  return plan
}

export type QueueDiscursiveTranscriptionsInput = {
  examId: number
  requestedBy: number
  correctionId?: number
  questionNumbers?: number[]
}

export type QueueDiscursiveTranscriptionsResult = {
  queued: number
  skipped: number
  unavailable: number
}

/**
 * Cria jobs leves (sem imagem, QR ou texto) para leituras ainda pendentes.
 * `OCR_QUEUED` impede clique repetido de duplicar trabalho enquanto o worker
 * ainda não fez o claim atômico do job.
 */
export async function queueDiscursiveTranscriptions(input: QueueDiscursiveTranscriptionsInput): Promise<QueueDiscursiveTranscriptionsResult> {
  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, input.examId) })
  if (!exam) throw new Error('Prova não encontrada para a fila de transcrição.')
  const plan = discursiveQuestionPlan(exam)
  const assignments = await db.query.examSheetAssignments.findMany({ where: and(eq(examSheetAssignments.examId, input.examId), input.correctionId ? eq(examSheetAssignments.examCorrectionId, input.correctionId) : undefined) })
  if (!assignments.length) return { queued: 0, skipped: 0, unavailable: 0 }

  const assignmentIds = assignments.map((assignment) => assignment.id)
  const corrections = await db.query.examCorrections.findMany({ where: inArray(examCorrections.id, assignments.map((assignment) => assignment.examCorrectionId)) })
  const correctionById = new Map(corrections.map((correction) => [correction.id, correction]))
  const pages = await db
    .select({
      id: examScanPages.id,
      uploadId: examScanPages.uploadId,
      assignmentId: examScanPages.sheetAssignmentId,
      correctionId: examSheetAssignments.examCorrectionId,
      sheetPageNumber: examScanPages.sheetPageNumber,
      canonicalDriveFileId: examScanPages.canonicalDriveFileId,
      createdAt: examScanPages.createdAt,
    })
    .from(examScanPages)
    .innerJoin(examScanUploads, eq(examScanPages.uploadId, examScanUploads.id))
    .innerJoin(examSheetAssignments, eq(examScanPages.sheetAssignmentId, examSheetAssignments.id))
    .where(and(inArray(examScanPages.sheetAssignmentId, assignmentIds), eq(examScanPages.pageType, 'discursive'), eq(examScanUploads.examId, input.examId)))
    .orderBy(desc(examScanPages.createdAt))
  const latestPageByAssignmentAndNumber = new Map<string, (typeof pages)[number]>()
  for (const page of pages) {
    if (page.assignmentId && page.sheetPageNumber) {
      const key = `${page.assignmentId}:${page.sheetPageNumber}`
      if (!latestPageByAssignmentAndNumber.has(key)) latestPageByAssignmentAndNumber.set(key, page)
    }
  }
  const currentPages = [...latestPageByAssignmentAndNumber.values()]
  const readings = currentPages.length ? await db.query.examScanReadings.findMany({ where: inArray(examScanReadings.pageId, currentPages.map((page) => page.id)) }) : []
  const readingByPageAndQuestion = new Map(readings.map((reading) => [`${reading.pageId}:${reading.questionNumber}`, reading]))

  const jobs: Array<{ jobType: 'transcrever_scan'; payload: { examId: number; pageId: number; questionNumber: number }; requestedBy: number; priority: number }> = []
  const readingsToQueue: Array<{ readingId: number; pageId: number; uploadId: number; questionNumber: number }> = []
  let skipped = 0
  let unavailable = 0

  for (const assignment of assignments) {
    const correction = correctionById.get(assignment.examCorrectionId)
    if (!correction) continue
    const answers = correction.answers as CorrectionAnswer[]
    for (const answer of answers) {
      if (answer.type !== 'descritiva') continue
      if (input.questionNumbers && !input.questionNumbers.includes(answer.questionNumber)) continue
      const expected = plan.get(answer.questionNumber)
      if (!expected) continue
      const page = latestPageByAssignmentAndNumber.get(`${assignment.id}:${expected.pageNumber}`)
      if (!page?.canonicalDriveFileId) {
        unavailable += 1
        continue
      }
      let reading = readingByPageAndQuestion.get(`${page.id}:${answer.questionNumber}`)
      if (reading?.reviewStatus === 'accepted' || reading?.reviewStatus === 'rejected' || reading?.suggestedTranscription || reading?.exceptionCode === 'OCR_QUEUED' || reading?.exceptionCode === 'OCR_PROCESSING') {
        skipped += 1
        continue
      }
      if (!reading) {
        const [created] = await db.insert(examScanReadings).values({ pageId: page.id, questionNumber: answer.questionNumber, kind: 'discursive', exceptionCode: 'OCR_QUEUED' }).returning()
        reading = created
        readingByPageAndQuestion.set(`${page.id}:${answer.questionNumber}`, reading)
      } else {
        await db.update(examScanReadings).set({ exceptionCode: 'OCR_QUEUED', updatedAt: new Date() }).where(eq(examScanReadings.id, reading.id))
      }
      jobs.push({ jobType: 'transcrever_scan', payload: { examId: input.examId, pageId: page.id, questionNumber: answer.questionNumber }, requestedBy: input.requestedBy, priority: 3 })
      readingsToQueue.push({ readingId: reading.id, pageId: page.id, uploadId: page.uploadId, questionNumber: answer.questionNumber })
    }
  }

  if (jobs.length) {
    await db.transaction(async (tx) => {
      await tx.insert(generationJobs).values(jobs)
      await tx.insert(examScanAuditEvents).values(readingsToQueue.map((reading) => ({
        examId: input.examId,
        uploadId: reading.uploadId,
        action: 'teacher_discursive_ocr_queued',
        actorId: input.requestedBy,
        metadata: { pageId: reading.pageId, readingId: reading.readingId, questionNumber: reading.questionNumber },
      })))
    })
  }
  return { queued: jobs.length, skipped, unavailable }
}

export async function executeDiscursiveTranscriptionJob(input: { examId: number; pageId: number; questionNumber: number; requestedBy: number }) {
  const [row] = await db
    .select({
      pageId: examScanPages.id,
      uploadId: examScanPages.uploadId,
      assignmentId: examScanPages.sheetAssignmentId,
      sheetPageNumber: examScanPages.sheetPageNumber,
      correctionId: examSheetAssignments.examCorrectionId,
      canonicalDriveFileId: examScanPages.canonicalDriveFileId,
    })
    .from(examScanPages)
    .innerJoin(examSheetAssignments, eq(examScanPages.sheetAssignmentId, examSheetAssignments.id))
    .innerJoin(generatedExams, eq(examSheetAssignments.examId, generatedExams.id))
    .where(and(eq(examScanPages.id, input.pageId), eq(generatedExams.id, input.examId)))
    .limit(1)
  if (!row?.canonicalDriveFileId || !row.assignmentId || !row.sheetPageNumber) throw new Error('Página discursiva privada não está disponível para transcrição.')
  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, input.examId) })
  if (!exam) throw new Error('Prova não encontrada para a transcrição.')
  const expected = discursiveQuestionPlan(exam).get(input.questionNumber)
  if (!expected || expected.pageNumber !== row.sheetPageNumber) throw new Error('Questão discursiva não corresponde à página da fila.')

  let reading = await db.query.examScanReadings.findFirst({ where: and(eq(examScanReadings.pageId, row.pageId), eq(examScanReadings.questionNumber, input.questionNumber)) })
  if (!reading) throw new Error('Leitura discursiva da fila não encontrada.')
  if (reading.reviewStatus === 'accepted' || reading.reviewStatus === 'rejected' || reading.suggestedTranscription) return { skipped: true }
  await db.update(examScanReadings).set({ exceptionCode: 'OCR_PROCESSING', updatedAt: new Date() }).where(eq(examScanReadings.id, reading.id))

  try {
    const canonical = await downloadPrivateScanBytes(row.canonicalDriveFileId)
    const crop = await cropDiscursiveAnswer({ canonicalImage: canonical, questionIndex: expected.questionIndex, questionsOnPage: expected.questionsOnPage })
    if (!reading.cropDriveFileId) {
      await stageAndArchivePrivateArtifact({
        bytes: crop,
        examId: input.examId,
        uploadId: row.uploadId,
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
      // Uma resposta legível já é copiada para a correção formal logo abaixo.
      // Não existe uma etapa de revisão separada para esse fluxo: registrar a
      // mesma transcrição como confirmada evita que a UI continue tratando a
      // leitura automática como pendência.
      confirmedTranscription: ocr.legible ? ocr.transcription : null,
      confidence: ocr.confidence,
      exceptionCode: ocr.legible ? null : 'OCR_UNREADABLE',
      reviewStatus: ocr.legible ? 'accepted' : 'pending',
      modelReference: `${ocr.provider}:${ocr.model}`.slice(0, 120),
      updatedAt: new Date(),
    }).where(eq(examScanReadings.id, reading.id)).returning()

    // O scan passa a alimentar a correção formal automaticamente. A nota da
    // dissertativa continua provisória (correção em status pendente) e pode
    // ser ajustada pelo professor antes da revisão final.
    if (ocr.legible && ocr.transcription.trim()) {
      const question = (exam.generationPayload as ExamGenerationResult).questions.find((item) => item.number === input.questionNumber)
      let suggestion: Awaited<ReturnType<typeof suggestGrade>> | null = null
      if (question) {
        try {
          suggestion = await suggestGrade({
            statement: question.statement,
            expectedAnswer: question.expectedAnswer ?? null,
            gradingCriteria: question.gradingCriteria ?? null,
            studentAnswer: ocr.transcription,
          })
        } catch (error) {
          console.warn('[scan OCR] transcrição concluída, mas a sugestão de nota falhou:', error instanceof Error ? error.message : error)
        }
      }
      await db.transaction(async (tx) => {
        // Várias questões de uma mesma folha são transcritas em paralelo. O
        // lock evita que uma gravação do JSON de respostas apague a outra.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${row.correctionId})`)
        const correction = await tx.query.examCorrections.findFirst({ where: eq(examCorrections.id, row.correctionId) })
        if (!correction) return
        const answers = (correction.answers as CorrectionAnswer[]).map((answer) => answer.questionNumber === input.questionNumber && answer.type === 'descritiva'
          ? {
              ...answer,
              transcribedAnswer: ocr.transcription,
              aiSuggestedGrade: suggestion?.grade ?? answer.aiSuggestedGrade,
              aiSuggestedFeedback: suggestion?.feedback ?? answer.aiSuggestedFeedback,
              finalGrade: suggestion?.grade ?? answer.finalGrade,
              finalFeedback: suggestion?.feedback ?? answer.finalFeedback,
            }
          : answer)
        await tx.update(examCorrections).set({ answers, updatedAt: new Date() }).where(eq(examCorrections.id, correction.id))
      })
      await enqueuePontuarProvaJob(input.examId, input.requestedBy).catch((error) => console.warn('[scan OCR] não foi possível enfileirar a pontuação:', error instanceof Error ? error.message : error))
    }
    await db.insert(examScanAuditEvents).values({ examId: input.examId, uploadId: row.uploadId, action: 'worker_discursive_ocr_completed', actorId: input.requestedBy, metadata: { pageId: row.pageId, readingId: reading.id, questionNumber: input.questionNumber, legible: ocr.legible } })
    return { skipped: false, legible: ocr.legible, readingId: updated.id }
  } catch (error) {
    const failureCode = error instanceof DiscursiveOcrError ? error.failureCode : 'OCR_FAILED'
    await db.update(examScanReadings).set({ exceptionCode: failureCode.slice(0, 80), updatedAt: new Date() }).where(eq(examScanReadings.id, reading.id))
    throw error
  }
}
