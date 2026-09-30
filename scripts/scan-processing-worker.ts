/**
 * Worker exclusivo do primeiro estágio do scan: download, QR, alinhamento e
 * leitura OMR. É separado da geração por IA para que uma fila de folhas não
 * impeça o professor de criar ou pontuar provas.
 */
import fs from 'node:fs'
import path from 'node:path'
import { claimNextScanProcessingJob, completeJob, failJob, heartbeatJob, requeueStaleJobs, type ClaimedJob } from '../src/lib/queue/claim'
import { executeJob } from '../src/lib/queue/handlers'
import { markLocalScanPageFailure } from '../src/lib/scan-ingest/localScanProcessor'
import { processarScanJobPayloadSchema } from '../src/lib/queue/types'

const POLL_MS = 1_000
const STALE_CHECK_MS = 5 * 60_000
const STALE_JOB_MINUTES = 15
const HEARTBEAT_MS = 20_000
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
  const startedAt = Date.now()
  const heartbeat = setInterval(() => { void heartbeatJob(job.id).catch(() => undefined) }, HEARTBEAT_MS)
  console.log(`[scan-processing-worker] job #${job.id} iniciado (tentativa ${job.attempts}/${job.maxAttempts})`)
  try {
    const result = await executeJob(job)
    await completeJob(job.id, { resultExamId: result.resultExamId, resultRef: result.resultRef })
    console.log(`[scan-processing-worker] job #${job.id} concluído em ${Date.now() - startedAt}ms`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = await failJob(job, message)
    const payload = processarScanJobPayloadSchema.safeParse(job.payload)
    if (status === 'erro' && payload.success && payload.data.pageId) {
      await markLocalScanPageFailure({
        examId: payload.data.examId,
        uploadId: payload.data.uploadId,
        attemptId: payload.data.attemptId,
        pageId: payload.data.pageId,
        error: message,
      }).catch((markError) => console.error('[scan-processing-worker] falha ao marcar página para revisão:', markError))
    }
    console.error(`[scan-processing-worker] job #${job.id} falhou (${status}) após ${Date.now() - startedAt}ms: ${message}`)
  } finally {
    clearInterval(heartbeat)
  }
}

async function main() {
  loadLocalEnvFile()
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurado para o worker de leitura de scan.')
  console.log('[scan-processing-worker] iniciado; aguardando scans')
  await requeueStaleJobs(STALE_JOB_MINUTES)
  let lastStaleCheck = Date.now()
  while (!shuttingDown) {
    if (Date.now() - lastStaleCheck >= STALE_CHECK_MS) {
      lastStaleCheck = Date.now()
      await requeueStaleJobs(STALE_JOB_MINUTES)
    }
    const job = await claimNextScanProcessingJob()
    if (!job) {
      await sleep(POLL_MS)
      continue
    }
    await runOnce(job)
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { shuttingDown = true })

main().catch((error) => {
  console.error('[scan-processing-worker] erro fatal:', error)
  process.exit(1)
})
