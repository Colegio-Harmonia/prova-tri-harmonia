import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from './src/db/client'
import { examCorrections, examScanAuditEvents, examScanPages, examScanProcessingAttempts, examScanReadings, examScanUploads, examSheetAssignments, generationJobs, pedagogicalClassificationAudit, pedagogicalClassifications, generatedExams } from './src/db/schema'
import { buildEmptyAnswers } from './src/lib/corrections/buildEmptyAnswers'
import type { ExamGenerationResult } from './src/lib/gemini/examSchema'

async function clearScans() {
  const examId = 133
  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
  if (!exam) {
    console.log('Exam not found')
    process.exit(1)
  }

  const uploads = await db.query.examScanUploads.findMany({ where: eq(examScanUploads.examId, examId) })
  const uploadIds = uploads.map(u => u.id)
  
  if (uploadIds.length === 0) {
    console.log('No scans found for exam 133.')
  }

  await db.transaction(async (tx) => {
    // Delete readings
    const pages = await tx.query.examScanPages.findMany({ where: uploadIds.length ? inArray(examScanPages.uploadId, uploadIds) : sql`1=0` })
    const pageIds = pages.map(p => p.id)
    
    if (pageIds.length) {
      await tx.delete(examScanReadings).where(inArray(examScanReadings.pageId, pageIds))
      await tx.execute(sql`DELETE FROM generation_jobs WHERE job_type = 'transcrever_scan' AND (payload ->> 'pageId')::int IN (${sql.join(pageIds.map((pageId) => sql`${pageId}`), sql`, `)})`)
    }

    if (uploadIds.length) {
      await tx.execute(sql`DELETE FROM generation_jobs WHERE payload ->> 'examId' = ${String(examId)}`)
      await tx.delete(examScanAuditEvents).where(inArray(examScanAuditEvents.uploadId, uploadIds))
      await tx.delete(examScanPages).where(inArray(examScanPages.uploadId, uploadIds))
      await tx.delete(examScanProcessingAttempts).where(inArray(examScanProcessingAttempts.uploadId, uploadIds))
      await tx.delete(examScanUploads).where(inArray(examScanUploads.id, uploadIds))
    }

    // Reset corrections
    const corrections = await tx.query.examCorrections.findMany({ where: eq(examCorrections.examId, examId) })
    const correctionIds = corrections.map(c => c.id)

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
  })

  console.log('Successfully cleared all scans and reset corrections for exam 133.')
  process.exit(0)
}

clearScans().catch(console.error)
