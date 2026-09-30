/** Reprocessa somente as páginas pendentes/com erro de uma prova usando a
 * imagem já arquivada. Não cria upload novo e não toca em páginas concluídas. */
import fs from 'node:fs'
import path from 'node:path'
import { asc, eq } from 'drizzle-orm'

function loadDatabaseUrlFromLocalEnv() {
  if (process.env.DATABASE_URL) return
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find((item) => item.trim().startsWith('DATABASE_URL='))
  if (line) process.env.DATABASE_URL = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

async function main() {
  const examId = Number(process.argv[2])
  if (!Number.isInteger(examId) || examId < 1) throw new Error('Uso: npm run scan:reprocess -- <examId> [requestedBy]')
  const requestedByArg = process.argv[3] ? Number(process.argv[3]) : null
  loadDatabaseUrlFromLocalEnv()
  const { db } = await import('../src/db/client')
  const { examScanPages, examScanUploads, generatedExams } = await import('../src/db/schema')
  const { enqueueLocalScanProcessing } = await import('../src/lib/scan-ingest/enqueueLocalScan')
  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
  if (!exam) throw new Error(`Prova #${examId} não encontrada.`)
  const uploads = await db.query.examScanUploads.findMany({ where: eq(examScanUploads.examId, examId), orderBy: [asc(examScanUploads.id)] })
  let requestedBy = requestedByArg
  const results: Array<{ uploadId: number; pageCount: number; jobIds: number[] }> = []
  for (const upload of uploads) {
    const pages = await db.query.examScanPages.findMany({ where: eq(examScanPages.uploadId, upload.id), orderBy: [asc(examScanPages.pageIndex)] })
    const failed = pages.some((page) => page.status !== 'processed' || Boolean(page.exceptionCode))
    if (!failed) continue
    if (!requestedBy) requestedBy = upload.createdBy
    if (!requestedBy) throw new Error(`Defina requestedBy para o upload #${upload.id}.`)
    const attempt = await enqueueLocalScanProcessing({ examId, uploadId: upload.id, requestedBy, generationPayload: exam.generationPayload, retryOnlyFailed: true })
    results.push({ uploadId: upload.id, pageCount: attempt.pageCount, jobIds: attempt.jobIds })
    console.log(`upload #${upload.id}: ${attempt.pageCount} página(s) enfileirada(s), job(s) ${attempt.jobIds.join(', ')}`)
  }
  console.log(JSON.stringify({ examId, uploads: results.length, results }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
