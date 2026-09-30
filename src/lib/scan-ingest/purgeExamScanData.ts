import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  examCorrections,
  examScanAuditEvents,
  examScanPages,
  examScanProcessingAttempts,
  examScanReadings,
  examScanUploads,
  generationJobs,
  generatedExams,
  pedagogicalClassificationAudit,
  pedagogicalClassifications,
} from '@/db/schema'
import { buildEmptyAnswers } from '@/lib/corrections/buildEmptyAnswers'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

export type PurgeExamScanResult = {
  examId: number
  uploads: number
  pages: number
  readings: number
  attempts: number
  auditEvents: number
  jobs: number
  correctionsReset: number
  classificationsRemoved: number
}

const scanJobTypes = ['transcrever_scan', 'processar_scan', 'pontuar_prova'] as const

/**
 * Descarta o processamento de scans de uma prova e volta suas correções para
 * pendente. As atribuições de folha, os QR codes e as correções continuam
 * existindo para que a mesma prova possa receber novos scans.
 *
 * Assim como o script scripts/purge_exam_scan_data.py, esta operação atua no
 * banco. Ela não remove objetos já arquivados no Google Drive.
 */
export async function purgeExamScanData(examId: number): Promise<PurgeExamScanResult> {
  return db.transaction(async (tx) => {
    const exam = await tx.query.generatedExams.findFirst({
      where: eq(generatedExams.id, examId),
      columns: { id: true, generationPayload: true },
    })
    if (!exam) throw new Error(`Prova ${examId} não encontrada.`)

    const uploads = await tx.query.examScanUploads.findMany({
      where: eq(examScanUploads.examId, examId),
      columns: { id: true },
    })
    const uploadIds = uploads.map((upload) => upload.id)
    const pages = uploadIds.length
      ? await tx.query.examScanPages.findMany({ where: inArray(examScanPages.uploadId, uploadIds), columns: { id: true } })
      : []
    const pageIds = pages.map((page) => page.id)
    const readings = pageIds.length
      ? await tx.query.examScanReadings.findMany({ where: inArray(examScanReadings.pageId, pageIds), columns: { id: true } })
      : []
    const attempts = uploadIds.length
      ? await tx.query.examScanProcessingAttempts.findMany({ where: inArray(examScanProcessingAttempts.uploadId, uploadIds), columns: { id: true } })
      : []
    const auditEvents = await tx.query.examScanAuditEvents.findMany({ where: eq(examScanAuditEvents.examId, examId), columns: { id: true } })
    const corrections = await tx.query.examCorrections.findMany({ where: eq(examCorrections.examId, examId), columns: { id: true } })
    const correctionIds = corrections.map((correction) => correction.id)
    const classifications = correctionIds.length
      ? await tx.query.pedagogicalClassifications.findMany({
          where: and(
            eq(pedagogicalClassifications.classifiableType, 'exam_correction_answer'),
            inArray(pedagogicalClassifications.classifiableId, correctionIds),
          ),
          columns: { id: true },
        })
      : []

    const examJobs = await tx.execute(sql`
      SELECT id
      FROM generation_jobs
      WHERE job_type IN (${sql.join(scanJobTypes.map((jobType) => sql`${jobType}`), sql`, `)})
        AND payload ->> 'examId' = ${String(examId)}
    `)
    const pageJobs = pageIds.length
      ? await tx.execute(sql`
          SELECT id
          FROM generation_jobs
          WHERE job_type = 'transcrever_scan'
            AND payload ->> 'pageId' IN (${sql.join(pageIds.map((pageId) => sql`${String(pageId)}`), sql`, `)})
        `)
      : []

    if (pageIds.length) await tx.delete(examScanReadings).where(inArray(examScanReadings.pageId, pageIds))
    if (pageIds.length) await tx.delete(examScanPages).where(inArray(examScanPages.id, pageIds))
    await tx.delete(examScanAuditEvents).where(eq(examScanAuditEvents.examId, examId))
    if (uploadIds.length) await tx.delete(examScanProcessingAttempts).where(inArray(examScanProcessingAttempts.uploadId, uploadIds))
    if (uploadIds.length) await tx.delete(examScanUploads).where(inArray(examScanUploads.id, uploadIds))

    await tx.delete(generationJobs).where(sql`
      job_type IN (${sql.join(scanJobTypes.map((jobType) => sql`${jobType}`), sql`, `)})
      AND payload ->> 'examId' = ${String(examId)}
    `)
    if (pageIds.length) await tx.delete(generationJobs).where(sql`
      job_type = 'transcrever_scan'
      AND payload ->> 'pageId' IN (${sql.join(pageIds.map((pageId) => sql`${String(pageId)}`), sql`, `)})
    `)

    if (classifications.length) {
      const classificationIds = classifications.map((classification) => classification.id)
      await tx.delete(pedagogicalClassificationAudit).where(inArray(pedagogicalClassificationAudit.classificationId, classificationIds))
      await tx.delete(pedagogicalClassifications).where(inArray(pedagogicalClassifications.id, classificationIds))
    }

    if (correctionIds.length) {
      const emptyAnswers = buildEmptyAnswers(exam.generationPayload as ExamGenerationResult)
      await tx.update(examCorrections).set({
        answers: emptyAnswers,
        status: 'pendente',
        scoreResult: null,
        gradeReturnedAt: null,
        updatedAt: new Date(),
      }).where(inArray(examCorrections.id, correctionIds))
    }

    // Sem resultados válidos de correção, a prova volta ao estado em que pode
    // receber uma nova aplicação. As folhas/QRs permanecem emitidos.
    await tx.update(generatedExams).set({
      status: 'aplicado',
      correctedAt: null,
    }).where(eq(generatedExams.id, examId))

    return {
      examId,
      uploads: uploads.length,
      pages: pages.length,
      readings: readings.length,
      attempts: attempts.length,
      auditEvents: auditEvents.length,
      jobs: new Set([...examJobs, ...pageJobs].map((job) => Number((job as { id: number }).id))).size,
      correctionsReset: correctionIds.length,
      classificationsRemoved: classifications.length,
    }
  })
}
