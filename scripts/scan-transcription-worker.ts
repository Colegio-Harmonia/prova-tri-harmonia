/**
 * Worker exclusivo de OCR/HTR. Pode rodar em mais de uma instância porque o
 * claim usa FOR UPDATE SKIP LOCKED; cada leitura é processada uma única vez.
 */
import fs from 'node:fs'
import path from 'node:path'
import { claimNextJob, completeJob, failJob, requeueStaleJobs, type ClaimedJob } from '../src/lib/queue/claim'
import { executeJob } from '../src/lib/queue/handlers'

const POLL_MS = 1_000
const STALE_CHECK_MS = 5 * 60_000
const STALE_JOB_MINUTES = 15
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
  try {
    const result = await executeJob(job)
    await completeJob(job.id, { resultExamId: result.resultExamId, resultRef: result.resultRef })
    console.log(`[scan-worker] job #${job.id} concluído (${job.jobType})`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = await failJob(job, message)
    console.error(`[scan-worker] job #${job.id} falhou (${status}): ${message}`)
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
