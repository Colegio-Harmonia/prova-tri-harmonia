import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from './src/db/client'
import { examCorrections, examScanAuditEvents, examScanPages, examScanProcessingAttempts, examScanReadings, examScanUploads, examSheetAssignments, pedagogicalClassificationAudit, pedagogicalClassifications, generatedExams } from './src/db/schema'
import { buildEmptyAnswers } from './src/lib/corrections/buildEmptyAnswers'
import type { ExamGenerationResult } from './src/lib/gemini/examSchema'

const examIds = [124, 166, 168] as const
const scanJobTypes = ['transcrever_scan', 'processar_scan', 'pontuar_prova'] as const

async function clearScans() {
  const exams = await db.query.generatedExams.findMany({ where: inArray(generatedExams.id, [...examIds]) })
  const examsById = new Map(exams.map((exam) => [exam.id, exam]))
  const missing = examIds.filter((examId) => !examsById.has(examId))
  if (missing.length) {
    throw new Error(`Prova(s) não encontrada(s): ${missing.join(', ')}.`)
  }

  const before = await Promise.all(examIds.map(async (examId) => {
    const [uploads, corrections, assignments] = await Promise.all([
      db.query.examScanUploads.findMany({ where: eq(examScanUploads.examId, examId), columns: { id: true } }),
      db.query.examCorrections.findMany({ where: eq(examCorrections.examId, examId), columns: { id: true } }),
      db.query.examSheetAssignments.findMany({ where: eq(examSheetAssignments.examId, examId), columns: { id: true } }),
    ])
    return { examId, uploads: uploads.length, corrections: corrections.length, assignments: assignments.length }
  }))
  console.log('Antes da limpeza:', JSON.stringify(before))

  await db.transaction(async (tx) => {
    for (const examId of examIds) {
      const exam = examsById.get(examId)!
      const uploads = await tx.query.examScanUploads.findMany({ where: eq(examScanUploads.examId, examId) })
      const uploadIds = uploads.map((upload) => upload.id)

      if (uploadIds.length) {
        const pages = await tx.query.examScanPages.findMany({ where: inArray(examScanPages.uploadId, uploadIds) })
        const pageIds = pages.map((page) => page.id)

        if (pageIds.length) {
          await tx.delete(examScanReadings).where(inArray(examScanReadings.pageId, pageIds))
          await tx.delete(examScanPages).where(inArray(examScanPages.id, pageIds))
          await tx.execute(sql`DELETE FROM generation_jobs WHERE job_type = 'transcrever_scan' AND (payload ->> 'pageId')::int IN (${sql.join(pageIds.map((pageId) => sql`${pageId}`), sql`, `)})`)
        }

        await tx.delete(examScanAuditEvents).where(inArray(examScanAuditEvents.uploadId, uploadIds))
        await tx.delete(examScanProcessingAttempts).where(inArray(examScanProcessingAttempts.uploadId, uploadIds))
        await tx.delete(examScanUploads).where(inArray(examScanUploads.id, uploadIds))
      }

      // Remove only scan/scoring jobs for this exam. Generation and other
      // unrelated jobs remain untouched.
      await tx.execute(sql`DELETE FROM generation_jobs WHERE job_type IN (${sql.join(scanJobTypes.map((jobType) => sql`${jobType}`), sql`, `)}) AND payload ->> 'examId' = ${String(examId)}`)

      const corrections = await tx.query.examCorrections.findMany({ where: eq(examCorrections.examId, examId) })
      const correctionIds = corrections.map((correction) => correction.id)

      if (correctionIds.length) {
        const classifications = await tx.query.pedagogicalClassifications.findMany({
          where: and(eq(pedagogicalClassifications.classifiableType, 'exam_correction_answer'), inArray(pedagogicalClassifications.classifiableId, correctionIds)),
          columns: { id: true },
        })
        if (classifications.length) await tx.delete(pedagogicalClassificationAudit).where(inArray(pedagogicalClassificationAudit.classificationId, classifications.map((item) => item.id)))
        await tx.delete(pedagogicalClassifications).where(and(eq(pedagogicalClassifications.classifiableType, 'exam_correction_answer'), inArray(pedagogicalClassifications.classifiableId, correctionIds)))

        const emptyAnswers = buildEmptyAnswers(exam.generationPayload as ExamGenerationResult)
        await tx.update(examCorrections).set({
          answers: emptyAnswers,
          scoreResult: null,
          gradeReturnedAt: null,
          status: 'pendente',
          updatedAt: new Date(),
        }).where(inArray(examCorrections.id, correctionIds))
      }

      // Depois de zerar as correções, a prova volta ao estado de aplicação
      // para aceitar novos scans. Não toca nas folhas nem nos QR codes.
      await tx.update(generatedExams).set({
        status: 'aplicado',
        correctedAt: null,
        updatedAt: new Date(),
      }).where(eq(generatedExams.id, examId))
    }
  })

  const after = await Promise.all(examIds.map(async (examId) => {
    const [uploads, corrections, assignments] = await Promise.all([
      db.query.examScanUploads.findMany({ where: eq(examScanUploads.examId, examId), columns: { id: true } }),
      db.query.examCorrections.findMany({ where: eq(examCorrections.examId, examId) }),
      db.query.examSheetAssignments.findMany({ where: eq(examSheetAssignments.examId, examId), columns: { id: true } }),
    ])
    return {
      examId,
      uploads: uploads.length,
      corrections: corrections.length,
      assignments: assignments.length,
      correctionsReset: corrections.filter((correction) => correction.status === 'pendente' && correction.scoreResult === null && correction.gradeReturnedAt === null).length,
    }
  }))
  console.log('Depois da limpeza:', JSON.stringify(after))
  console.log('Scans e notas removidos; vínculos QR/folhas preservados.')
}

clearScans().catch(console.error)
