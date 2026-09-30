/**
 * Worker exclusivo de OCR/HTR. Pode rodar em mais de uma instância porque o
 * claim usa FOR UPDATE SKIP LOCKED; cada leitura é processada uma única vez.
 */
import fs from 'node:fs'
import path from 'node:path'
import { claimNextJob, completeJob, deferJobForAiBudget, deferJobForProvider, failJob, finalizeScanTranscriptionReadings, heartbeatJob, requeueStaleJobs, type ClaimedJob } from '../src/lib/queue/claim'
import { executeJob } from '../src/lib/queue/handlers'
import { AiBudgetExceededError, nextAiBudgetWindowStart } from '../src/lib/ai/operationBudget'
import { DiscursiveOcrError } from '../src/lib/scan-ingest/discursiveOcr'

const POLL_MS = 1_000
const STALE_CHECK_MS = 5 * 60_000
const STALE_JOB_MINUTES = 15
const PROVIDER_RETRY_DELAY_MS = 5 * 60_000
const TEMPORARY_PROVIDER_FAILURES = new Set(['rate_limited', 'provider_unavailable', 'provider_request_failed', 'timeout'])
let shuttingDown = false

function loadLocalEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const equalAt = trimmed.indexOf('=')
    if (equalAt <= 0) continue
    const key = trimmed.slice(0, equalAt).trim()
    if (process.env[key] === undefined) process.env[key] = trimmed.slice(equalAt + 1).trim().replace(/^['"]|['"]$/g, '')
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function runOnce(job: ClaimedJob) {
  const heartbeatInterval = setInterval(() => { void heartbeatJob(job.id).catch(() => {}) }, 20_000)
  try {
    const result = await executeJob(job)
    await completeJob(job.id, { resultExamId: result.resultExamId, resultRef: result.resultRef })
    if (job.jobType === 'transcrever_scan') await finalizeScanTranscriptionReadings(job.id, 'OCR_MISSING_RESULT')
    console.log(`[scan-worker] job #${job.id} concluído (${job.jobType})`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof AiBudgetExceededError) {
      const availableAt = nextAiBudgetWindowStart()
      await deferJobForAiBudget(job, availableAt, `${message} A transcrição será retomada automaticamente após ${availableAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`)
      console.warn(`[scan-worker] job #${job.id} aguardando a cota de leitura; tentativa preservada.`)
      clearInterval(heartbeatInterval)
      return
    }
    if (error instanceof DiscursiveOcrError && TEMPORARY_PROVIDER_FAILURES.has(error.failureCode)) {
      const availableAt = new Date(Date.now() + PROVIDER_RETRY_DELAY_MS)
      await deferJobForProvider(job, availableAt, `${message} A transcrição será retomada automaticamente após ${availableAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`)
      console.warn(`[scan-worker] job #${job.id} aguardando o provedor (${error.failureCode}); tentativa preservada.`)
      clearInterval(heartbeatInterval)
      return
    }
    const status = await failJob(job, message)
    if (job.jobType === 'transcrever_scan' && status === 'erro') await finalizeScanTranscriptionReadings(job.id, 'OCR_INTERRUPTED')
    console.error(`[scan-worker] job #${job.id} falhou (${status}): ${message}`)
  } finally {
    clearInterval(heartbeatInterval)
  }
}

async function main() {
  loadLocalEnvFile()
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurado para o worker de transcrição.')
  console.log('[scan-worker] iniciado; aguardando leituras discursivas')
  await requeueStaleJobs(STALE_JOB_MINUTES)
  let lastStaleCheck = Date.now()
  while (!shuttingDown) {
    if (Date.now() - lastStaleCheck >= STALE_CHECK_MS) {
      lastStaleCheck = Date.now()
      await requeueStaleJobs(STALE_JOB_MINUTES)
    }
    const job = await claimNextJob(['transcrever_scan'])
    if (!job) {
      await sleep(POLL_MS)
      continue
    }
    await runOnce(job)
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { shuttingDown = true })

main().catch((error) => {
  console.error('[scan-worker] erro fatal:', error)
  process.exit(1)
})
