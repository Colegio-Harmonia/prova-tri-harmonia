/**
 * Reconciliates discursive OCR states after a worker crash or an old queue
 * race. The default mode is read-only; pass --apply to persist the repair.
 */
import fs from 'node:fs'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'

function loadDatabaseUrlFromLocalEnv() {
  if (process.env.DATABASE_URL) return
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='))
  if (line) process.env.DATABASE_URL = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

type Orphan = { readingId: number; examId: number; correctionId: number | null; uploadId: number; pageId: number; questionNumber: number; exceptionCode: string | null }

async function main() {
  loadDatabaseUrlFromLocalEnv()
  const { db } = await import('../src/db/client')
  const { examScanAuditEvents, examScanReadings } = await import('../src/db/schema')
  const apply = process.argv.includes('--apply')
  const rows = await db.execute(sql`
    SELECT
      reading.id AS "readingId",
      upload.exam_id AS "examId",
      assignment.exam_correction_id AS "correctionId",
      page.upload_id AS "uploadId",
      page.id AS "pageId",
      reading.question_number AS "questionNumber",
      reading.exception_code AS "exceptionCode"
    FROM exam_scan_readings reading
    INNER JOIN exam_scan_pages page ON page.id = reading.page_id
    INNER JOIN exam_scan_uploads upload ON upload.id = page.upload_id
    LEFT JOIN exam_sheet_assignments assignment ON assignment.id = page.sheet_assignment_id
    WHERE reading.kind = 'discursive'
      AND COALESCE(reading.review_status, 'pending') = 'pending'
      AND reading.suggested_transcription IS NULL
      AND reading.exception_code IN ('OCR_QUEUED', 'OCR_PROCESSING', 'OCR_DEFERRED', 'AI_BUDGET_DEFERRED')
      AND NOT EXISTS (
        SELECT 1
        FROM generation_jobs job
        WHERE job.job_type = 'transcrever_scan'
          AND job.status IN ('pendente', 'gerando')
          AND job.payload ->> 'examId' = upload.exam_id::text
          AND job.payload ->> 'pageId' = page.id::text
          AND (jsonb_array_length(COALESCE(job.payload -> 'questionNumbers', '[]'::jsonb)) = 0
            OR job.payload -> 'questionNumbers' @> to_jsonb(reading.question_number))
      )
    ORDER BY upload.exam_id, reading.id
  `) as unknown as Orphan[]

  const foreignPages = await db.execute(sql`
    SELECT page.id
    FROM exam_scan_pages page
    INNER JOIN exam_scan_uploads upload ON upload.id = page.upload_id
    INNER JOIN exam_sheet_assignments assignment ON assignment.id = page.sheet_assignment_id
    WHERE upload.exam_id <> assignment.exam_id
  `) as unknown as Array<{ id: number }>

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', orphanReadings: rows.length, foreignAuthoritativePages: foreignPages.length, affected: rows.map((row) => ({ examId: row.examId, correctionId: row.correctionId, readingId: row.readingId, questionNumber: row.questionNumber, exceptionCode: row.exceptionCode })) }, null, 2))
  if (!apply || !rows.length) return

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const updated = await tx.update(examScanReadings)
        .set({ exceptionCode: 'OCR_INTERRUPTED', updatedAt: new Date() })
        .where(eq(examScanReadings.id, row.readingId))
        .returning({ id: examScanReadings.id })
      if (!updated.length) continue
      await tx.insert(examScanAuditEvents).values({
        examId: row.examId,
        uploadId: row.uploadId,
        action: 'scan_transcription_reconciled_without_active_job',
        metadata: { readingId: row.readingId, pageId: row.pageId, correctionId: row.correctionId, questionNumber: row.questionNumber, previousExceptionCode: row.exceptionCode },
      })
    }
  })
  console.log(`Corrigidas ${rows.length} leitura(s) órfã(s).`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
