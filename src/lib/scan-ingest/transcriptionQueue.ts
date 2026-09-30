import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { examCorrections, examScanAuditEvents, examScanPages, examScanReadings, examScanUploads, examSheetAssignments, generatedExams, generationJobs } from '@/db/schema'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { suggestGrade } from '@/lib/gemini/gradeSuggestion'
import { questionMaxGrade } from '@/lib/corrections/gradeNormalization'
import { enqueuePontuarProvaJob } from '@/lib/queue/enqueue'
import { classifyDiscursiveOcrResult, cropDiscursiveAnswer, DiscursiveOcrError, transcribeDiscursiveAnswer, transcribeDiscursiveAnswers } from '@/lib/scan-ingest/discursiveOcr'
import { stageAndArchivePrivateArtifact } from '@/lib/scan-ingest/privateArtifact'
import { downloadPrivateScanBytes } from '@/lib/scan-ingest/privateScanContent'
import { planSheetPages } from '@/lib/scan-sheets/sheetLayout'
import { runWithConcurrency } from '@/lib/scan-ingest/uploadConcurrency'
import type { CorrectionAnswer } from '@/types/correction'
import { AiBudgetExceededError } from '@/lib/ai/operationBudget'

type QuestionPlan = { pageNumber: number; questionIndex: number; questionsOnPage: number }

const TRANSIENT_OCR_FAILURES = new Set(['rate_limited', 'provider_unavailable', 'provider_request_failed', 'timeout'])
const BATCH_FALLBACK_FAILURES = new Set(['provider_empty_response', 'provider_invalid_response'])

type DiscursiveCrop = { questionNumber: number; image: Buffer; mimeType: 'image/jpeg' }
type DiscursiveBatchResult = Awaited<ReturnType<typeof transcribeDiscursiveAnswers>>

/**
 * Uma resposta em lote inválida não deve inutilizar todas as questões da
 * página. O fallback mantém a chamada em lote como caminho rápido, mas isola
 * cada questão quando o provedor devolve JSON vazio ou fora do contrato.
 */
async function transcribeCropsIndividually(crops: DiscursiveCrop[]): Promise<DiscursiveBatchResult> {
  const answers: DiscursiveBatchResult['answers'] = []
  let provider = 'unknown'
  let model = 'unknown'
  await runWithConcurrency(crops, 2, async (crop) => {
    const result = await transcribeDiscursiveAnswer({ image: crop.image, mimeType: crop.mimeType })
    provider = result.provider
    model = result.model
    answers.push({ questionNumber: crop.questionNumber, transcription: result.transcription, confidence: result.confidence, legible: result.legible, blank: result.blank })
  })
  return { answers, provider, model }
}

async function transcribeDiscursivePageAnswers(crops: DiscursiveCrop[]): Promise<DiscursiveBatchResult> {
  try {
    return await transcribeDiscursiveAnswers({ answers: crops })
  } catch (error) {
    if (!(error instanceof DiscursiveOcrError) || !BATCH_FALLBACK_FAILURES.has(error.failureCode)) throw error
    console.warn('[scan OCR] resposta em lote inválida; tentando uma questão por chamada para preservar o progresso.')
    return transcribeCropsIndividually(crops)
  }
}

function ocrFailureCode(error: unknown) {
  if (error instanceof AiBudgetExceededError) return 'AI_BUDGET_DEFERRED'
  if (error instanceof DiscursiveOcrError && TRANSIENT_OCR_FAILURES.has(error.failureCode)) return 'OCR_DEFERRED'
  return error instanceof DiscursiveOcrError ? error.failureCode : 'OCR_FAILED'
}

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
      exceptionCode: examScanPages.exceptionCode,
      createdAt: examScanPages.createdAt,
    })
    .from(examScanPages)
    .innerJoin(examScanUploads, eq(examScanPages.uploadId, examScanUploads.id))
    .innerJoin(examSheetAssignments, eq(examScanPages.sheetAssignmentId, examSheetAssignments.id))
    .where(and(inArray(examScanPages.sheetAssignmentId, assignmentIds), eq(examScanPages.pageType, 'discursive'), eq(examScanUploads.examId, input.examId), sql`${examScanPages.exceptionCode} IS DISTINCT FROM 'SCAN_BELONGS_TO_ANOTHER_EXAM'`))
    .orderBy(sql`CASE WHEN ${examScanPages.status} = 'processed' AND ${examScanPages.exceptionCode} IS NULL THEN 0 ELSE 1 END`, desc(examScanPages.createdAt))
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
  const activeJobRows = await db.execute(sql`
    SELECT payload, status, available_at
    FROM generation_jobs
    WHERE job_type = 'transcrever_scan'
      AND status IN ('pendente', 'gerando')
      AND payload ->> 'examId' = ${String(input.examId)}
  `) as unknown as Array<{ payload: { pageId?: number; questionNumbers?: number[] }; status: 'pendente' | 'gerando'; available_at: Date | null }>
  const activeJobForQuestion = (pageId: number, questionNumber: number) => activeJobRows.find((row) => Number(row.payload?.pageId) === pageId && (!row.payload?.questionNumbers?.length || row.payload.questionNumbers.includes(questionNumber)))

  const jobsByPage = new Map<number, { questionNumbers: number[]; requestedBy: number; priority: number }>()
  const readingsToQueue: Array<{ pageId: number; uploadId: number; questionNumber: number }> = []
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
      if (answer.transcribedAnswer.trim() || reading?.reviewStatus === 'accepted' || reading?.reviewStatus === 'rejected' || reading?.suggestedTranscription || activeJobForQuestion(page.id, answer.questionNumber)) {
        skipped += 1
        continue
      }
      const batch = jobsByPage.get(page.id) ?? { questionNumbers: [], requestedBy: input.requestedBy, priority: 3 }
      batch.questionNumbers.push(answer.questionNumber)
      jobsByPage.set(page.id, batch)
      readingsToQueue.push({ pageId: page.id, uploadId: page.uploadId, questionNumber: answer.questionNumber })
    }
  }

  const jobs = [...jobsByPage.entries()].map(([pageId, batch]) => ({
    jobType: 'transcrever_scan' as const,
    payload: { examId: input.examId, pageId, questionNumbers: batch.questionNumbers },
    requestedBy: batch.requestedBy,
    priority: batch.priority,
  }))
  if (jobs.length) {
    await db.transaction(async (tx) => {
      for (const job of jobs) {
        // A repeated request can arrive while the first transaction is still
        // assembling the page. The page lock serializes those requests and
        // the active-job check keeps one page from getting two OCR batches.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${job.payload.pageId})`)
        const active = await tx.execute(sql`
          SELECT id, payload, status FROM generation_jobs
          WHERE job_type = 'transcrever_scan'
            AND status IN ('pendente', 'gerando')
            AND payload ->> 'examId' = ${String(input.examId)}
            AND payload ->> 'pageId' = ${String(job.payload.pageId)}
          LIMIT 1
        `)
        const activeRows = active as unknown as Array<{ id: number; payload: { questionNumbers?: number[] }; status: string }>
        if (!activeRows.length) await tx.insert(generationJobs).values(job)
        else {
          // A page-level job processes all pending readings. If a second
          // request arrives while the first job is running, the new reading
          // is still covered and no orphaned OCR_QUEUED state is created.
          const existing = activeRows[0]
          const currentQuestions = Array.isArray(existing.payload?.questionNumbers) ? existing.payload.questionNumbers : []
          const mergedQuestions = [...new Set([...currentQuestions, ...job.payload.questionNumbers])]
          await tx.execute(sql`
            UPDATE generation_jobs
            SET payload = jsonb_set(payload, '{questionNumbers}', ${JSON.stringify(mergedQuestions)}::jsonb)
            WHERE id = ${existing.id} AND status = 'pendente'
          `)
        }
        const pageReadings = readingsToQueue.filter((reading) => reading.pageId === job.payload.pageId)
        for (const queued of pageReadings) {
          const existingReading = await tx.query.examScanReadings.findFirst({ where: and(eq(examScanReadings.pageId, queued.pageId), eq(examScanReadings.questionNumber, queued.questionNumber)) })
          if (!existingReading) {
            await tx.insert(examScanReadings).values({ pageId: queued.pageId, questionNumber: queued.questionNumber, kind: 'discursive', exceptionCode: 'OCR_QUEUED' })
          } else if (existingReading.reviewStatus !== 'accepted' && existingReading.reviewStatus !== 'rejected' && !existingReading.suggestedTranscription) {
            await tx.update(examScanReadings).set({ exceptionCode: 'OCR_QUEUED', updatedAt: new Date() }).where(eq(examScanReadings.id, existingReading.id))
          }
        }
        if (pageReadings.length) await tx.insert(examScanAuditEvents).values(pageReadings.map((reading) => ({
          examId: input.examId,
          uploadId: reading.uploadId,
          action: 'teacher_discursive_ocr_queued',
          actorId: input.requestedBy,
          metadata: { pageId: reading.pageId, questionNumber: reading.questionNumber },
        })))
      }
    })
  }
  return { queued: readingsToQueue.length, skipped, unavailable }
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
    const { blank, legible } = classifyDiscursiveOcrResult(ocr)
    const [updated] = await db.update(examScanReadings).set({
      suggestedTranscription: legible ? ocr.transcription : null,
      // Uma resposta legível já é copiada para a correção formal logo abaixo.
      // Não existe uma etapa de revisão separada para esse fluxo: registrar a
      // mesma transcrição como confirmada evita que a UI continue tratando a
      // leitura automática como pendência.
      confirmedTranscription: legible ? ocr.transcription : null,
      confidence: ocr.confidence,
      exceptionCode: blank || legible ? null : 'OCR_UNREADABLE',
      reviewStatus: blank ? 'rejected' : legible ? 'accepted' : 'pending',
      modelReference: `${ocr.provider}:${ocr.model}`.slice(0, 120),
      updatedAt: new Date(),
    }).where(eq(examScanReadings.id, reading.id)).returning()

    // O scan passa a alimentar a correção formal automaticamente. A nota da
    // dissertativa continua provisória (correção em status pendente) e pode
    // ser ajustada pelo professor antes da revisão final.
    if (blank || legible) {
      const question = (exam.generationPayload as ExamGenerationResult).questions.find((item) => item.number === input.questionNumber)
      let suggestion: Awaited<ReturnType<typeof suggestGrade>> | null = null
      if (legible && question) {
        try {
          suggestion = await suggestGrade({
            statement: question.statement,
            expectedAnswer: question.expectedAnswer ?? null,
            gradingCriteria: question.gradingCriteria ?? null,
            studentAnswer: ocr.transcription,
            maxGrade: questionMaxGrade(question),
          })
        } catch (error) {
          console.warn('[scan OCR] transcrição concluída, mas a sugestão de nota falhou:', error instanceof Error ? error.message : error)
        }
      }
      let appliedToCorrection = false
      await db.transaction(async (tx) => {
        // Várias questões de uma mesma folha são transcritas em paralelo. O
        // lock evita que uma gravação do JSON de respostas apague a outra.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${row.correctionId})`)
        const correction = await tx.query.examCorrections.findFirst({ where: eq(examCorrections.id, row.correctionId) })
        if (!correction) return
        const answers = (correction.answers as CorrectionAnswer[]).map((answer) => {
          if (answer.questionNumber !== input.questionNumber || answer.type !== 'descritiva') return answer
          const manuallyEdited = correction.status === 'revisado' || Boolean(answer.transcribedAnswer.trim() || answer.finalGrade !== null || answer.finalFeedback?.trim())
          if (manuallyEdited) return answer
          appliedToCorrection = true
          return {
            ...answer,
            transcribedAnswer: ocr.transcription,
            weight: answer.weight ?? (question ? questionMaxGrade(question) : 1),
            aiSuggestedRawGrade: suggestion?.rawGrade ?? answer.aiSuggestedRawGrade,
            aiSuggestedGradeScale: suggestion?.sourceScale ?? answer.aiSuggestedGradeScale,
            aiSuggestedGrade: suggestion?.grade ?? answer.aiSuggestedGrade,
            aiSuggestedFeedback: suggestion?.feedback ?? answer.aiSuggestedFeedback,
            finalGrade: blank ? (answer.finalGrade ?? 0) : suggestion?.grade ?? answer.finalGrade,
            finalFeedback: blank ? answer.finalFeedback : suggestion?.feedback ?? answer.finalFeedback,
          }
        })
        await tx.update(examCorrections).set({ answers, updatedAt: new Date() }).where(eq(examCorrections.id, correction.id))
      })
      if (appliedToCorrection) await enqueuePontuarProvaJob(input.examId, input.requestedBy).catch((error) => console.warn('[scan OCR] não foi possível enfileirar a pontuação:', error instanceof Error ? error.message : error))
    }
    await db.insert(examScanAuditEvents).values({ examId: input.examId, uploadId: row.uploadId, action: 'worker_discursive_ocr_completed', actorId: input.requestedBy, metadata: { pageId: row.pageId, readingId: reading.id, questionNumber: input.questionNumber, legible, blank } })
    return { skipped: false, legible, blank, readingId: updated.id }
  } catch (error) {
    const failureCode = ocrFailureCode(error)
    await db.update(examScanReadings).set({ exceptionCode: failureCode.slice(0, 80), updatedAt: new Date() }).where(eq(examScanReadings.id, reading.id))
    throw error
  }
}

/** Executa uma chamada de OCR para todos os recortes discursivos da mesma
 * página. A atualização de cada leitura continua independente e idempotente. */
export async function executeDiscursivePageTranscriptionJob(input: { examId: number; pageId: number; questionNumbers: number[]; requestedBy: number }) {
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
  const plan = discursiveQuestionPlan(exam)
  const expected = [...plan.entries()]
    .filter(([, questionPlan]) => questionPlan.pageNumber === row.sheetPageNumber)
    .map(([questionNumber, questionPlan]) => ({ questionNumber, plan: questionPlan }))
  if (!expected.length || input.questionNumbers.some((questionNumber) => !expected.some((item) => item.questionNumber === questionNumber))) throw new Error('Uma questão discursiva não corresponde à página da fila.')

  // O trabalho é por página: uma segunda solicitação pode ter incluído uma
  // questão depois que o job foi criado. Descobrir todas as leituras pendentes
  // aqui evita que ela fique marcada como OCR_QUEUED sem ser processada.
  const readings = await db.query.examScanReadings.findMany({ where: eq(examScanReadings.pageId, row.pageId) })
  const readingByQuestion = new Map(readings.map((reading) => [reading.questionNumber, reading]))
  const pending = expected.filter(({ questionNumber }) => {
    const reading = readingByQuestion.get(questionNumber)
    return reading && reading.reviewStatus !== 'accepted' && reading.reviewStatus !== 'rejected' && !reading.suggestedTranscription
  })
  if (!pending.length) return { skipped: true, pageId: row.pageId, questionNumbers: input.questionNumbers }
  const pendingReadings = pending.map(({ questionNumber }) => readingByQuestion.get(questionNumber)!).filter(Boolean)
  await db.update(examScanReadings).set({ exceptionCode: 'OCR_PROCESSING', updatedAt: new Date() }).where(inArray(examScanReadings.id, pendingReadings.map((reading) => reading.id)))

  const canonical = await downloadPrivateScanBytes(row.canonicalDriveFileId)
  const crops: DiscursiveCrop[] = []
  for (const item of pending) {
    const reading = readingByQuestion.get(item.questionNumber)!
    const crop = await cropDiscursiveAnswer({ canonicalImage: canonical, questionIndex: item.plan.questionIndex, questionsOnPage: item.plan.questionsOnPage })
    if (!reading.cropDriveFileId) {
      await stageAndArchivePrivateArtifact({
        bytes: crop,
        examId: input.examId,
        uploadId: row.uploadId,
        artifact: 'reading_crop',
        artifactId: reading.id,
        saveStagingKey: async (key) => { await db.update(examScanReadings).set({ cropStagingObjectKey: key, cropArchiveErrorCode: null, updatedAt: new Date() }).where(eq(examScanReadings.id, reading.id)) },
        saveArchived: async (artifact, inspection) => { await db.update(examScanReadings).set({ cropDriveFileId: artifact.driveFileId, cropVerifiedSha256: artifact.verifiedSha256, cropMimeType: inspection.mimeType, cropStagingObjectKey: null, cropArchivedAt: new Date(), cropArchiveErrorCode: null, updatedAt: new Date() }).where(eq(examScanReadings.id, reading.id)) },
        saveFailure: async () => { await db.update(examScanReadings).set({ cropArchiveErrorCode: 'ARCHIVE_FAILED', updatedAt: new Date() }).where(eq(examScanReadings.id, reading.id)) },
      })
    }
    crops.push({ questionNumber: item.questionNumber, image: crop, mimeType: 'image/jpeg' })
  }

  try {
    let ocr = await transcribeDiscursivePageAnswers(crops)
    let resultByQuestion = new Map(ocr.answers.map((answer) => [answer.questionNumber, answer]))
    const missingCrops = crops.filter((crop) => !resultByQuestion.has(crop.questionNumber))
    if (missingCrops.length) {
      console.warn(`[scan OCR] o lote não devolveu ${missingCrops.length} questão(ões); tentando as ausentes individualmente.`)
      const recovered = await transcribeCropsIndividually(missingCrops)
      ocr = { ...ocr, answers: [...ocr.answers, ...recovered.answers], provider: recovered.provider, model: recovered.model }
      resultByQuestion = new Map(ocr.answers.map((answer) => [answer.questionNumber, answer]))
    }
    const correctionUpdates: Array<{ questionNumber: number; transcription: string; question: (ExamGenerationResult['questions'][number]) | undefined; suggestion: Awaited<ReturnType<typeof suggestGrade>> | null; blank: boolean }> = []
    const legibleAnswers: Array<{ questionNumber: number; transcription: string; question: (ExamGenerationResult['questions'][number]) | undefined }> = []
    for (const item of pending) {
      const reading = readingByQuestion.get(item.questionNumber)!
      const result = resultByQuestion.get(item.questionNumber)
      if (!result) {
        await db.update(examScanReadings).set({ exceptionCode: 'OCR_MISSING_RESULT', updatedAt: new Date() }).where(eq(examScanReadings.id, reading.id))
        continue
      }
      const { blank, legible } = classifyDiscursiveOcrResult(result)
      await db.update(examScanReadings).set({
        suggestedTranscription: legible ? result.transcription : null,
        confirmedTranscription: legible ? result.transcription : null,
        confidence: result.confidence,
        exceptionCode: blank || legible ? null : 'OCR_UNREADABLE',
        reviewStatus: blank ? 'rejected' : legible ? 'accepted' : 'pending',
        modelReference: `${ocr.provider}:${ocr.model}`.slice(0, 120),
        updatedAt: new Date(),
      }).where(eq(examScanReadings.id, reading.id))
      const question = (exam.generationPayload as ExamGenerationResult).questions.find((candidate) => candidate.number === item.questionNumber)
      if (blank) {
        correctionUpdates.push({ questionNumber: item.questionNumber, transcription: '', question, suggestion: null, blank: true })
        continue
      }
      if (!legible) continue
      legibleAnswers.push({ questionNumber: item.questionNumber, transcription: result.transcription, question })
    }
    // A leitura visual já terminou neste ponto. As sugestões de nota são
    // independentes e rodam com concorrência limitada para não manter o OCR
    // serializado nem abrir chamadas ilimitadas ao provedor de texto.
    await runWithConcurrency(legibleAnswers, 2, async (item) => {
      let suggestion: Awaited<ReturnType<typeof suggestGrade>> | null = null
      if (item.question) {
        try {
          suggestion = await suggestGrade({ statement: item.question.statement, expectedAnswer: item.question.expectedAnswer ?? null, gradingCriteria: item.question.gradingCriteria ?? null, studentAnswer: item.transcription, maxGrade: questionMaxGrade(item.question) })
        } catch (error) {
          console.warn('[scan OCR] transcrição em lote concluída, mas a sugestão de nota falhou:', error instanceof Error ? error.message : error)
        }
      }
      correctionUpdates.push({ ...item, suggestion, blank: false })
    })

    let appliedToCorrection = false
    if (correctionUpdates.length) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${row.correctionId})`)
        const correction = await tx.query.examCorrections.findFirst({ where: eq(examCorrections.id, row.correctionId) })
        if (!correction) return
        const answers = (correction.answers as CorrectionAnswer[]).map((answer) => {
          const update = correctionUpdates.find((item) => item.questionNumber === answer.questionNumber)
          if (!update || answer.type !== 'descritiva') return answer
          const manuallyEdited = correction.status === 'revisado' || Boolean(answer.transcribedAnswer.trim() || answer.finalGrade !== null || answer.finalFeedback?.trim())
          if (manuallyEdited) return answer
          appliedToCorrection = true
          return { ...answer, transcribedAnswer: update.transcription, weight: answer.weight ?? (update.question ? questionMaxGrade(update.question) : 1), aiSuggestedRawGrade: update.suggestion?.rawGrade ?? answer.aiSuggestedRawGrade, aiSuggestedGradeScale: update.suggestion?.sourceScale ?? answer.aiSuggestedGradeScale, aiSuggestedGrade: update.suggestion?.grade ?? answer.aiSuggestedGrade, aiSuggestedFeedback: update.suggestion?.feedback ?? answer.aiSuggestedFeedback, finalGrade: update.blank ? (answer.finalGrade ?? 0) : update.suggestion?.grade ?? answer.finalGrade, finalFeedback: update.blank ? answer.finalFeedback : update.suggestion?.feedback ?? answer.finalFeedback }
        })
        await tx.update(examCorrections).set({ answers, updatedAt: new Date() }).where(eq(examCorrections.id, correction.id))
      })
      if (appliedToCorrection) await enqueuePontuarProvaJob(input.examId, input.requestedBy).catch((error) => console.warn('[scan OCR] não foi possível enfileirar a pontuação:', error instanceof Error ? error.message : error))
    }
    await db.insert(examScanAuditEvents).values({ examId: input.examId, uploadId: row.uploadId, action: 'worker_discursive_ocr_completed', actorId: input.requestedBy, metadata: { pageId: row.pageId, questionNumbers: input.questionNumbers, batched: true, legible: correctionUpdates.filter((item) => !item.blank).length, blank: correctionUpdates.filter((item) => item.blank).length } })
    return { skipped: false, pageId: row.pageId, questionNumbers: input.questionNumbers, completed: correctionUpdates.length }
  } catch (error) {
    const failureCode = ocrFailureCode(error)
    await db.update(examScanReadings).set({ exceptionCode: failureCode.slice(0, 80), updatedAt: new Date() }).where(inArray(examScanReadings.id, pendingReadings.map((reading) => reading.id)))
    throw error
  }
}
