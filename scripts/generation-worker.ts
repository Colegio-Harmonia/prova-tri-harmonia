/**
 * Worker da fila de geração (Subtarefa 1a, 24/07/2026) — serviço Docker
 * separado (`worker`, ver docker-compose.yml). Consome
 * `generation_jobs` via claim atômico (FOR UPDATE SKIP LOCKED) e executa
 * os handlers de src/lib/queue/handlers.ts.
 *
 * Executa um job por vez. A geração de cada prova também é serial por questão,
 * evitando chamadas simultâneas ao provedor e progresso enganoso na fila.
 *
 * Rodar: npm run worker (produção: Docker Compose; dev: direto no terminal).
 */
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { GENERATION_JOB_TYPES, users } from '../src/db/schema'
import { claimNextJob, completeJob, deferJobForAiBudget, deferJobForProvider, failJob, heartbeatJob, requeueStaleJobs, type ClaimedJob } from '../src/lib/queue/claim'
import { executeJob, gerarProvaJobLabel } from '../src/lib/queue/handlers'
import { AiBudgetExceededError, nextAiBudgetWindowStart } from '../src/lib/ai/operationBudget'
import { StructuredGenerationError } from '../src/lib/gemini/structuredRepair'
import { JevUnavailableError } from '../src/lib/ai/jevClient'
import { classifyAiFailure } from '../src/lib/ai/operationTelemetry'
import { isPermanentAiProviderFailure } from '../src/lib/ai/providerFailure'
import { sendChatGenerationJobNotification } from '../src/lib/notifications/googleChat'

const POLL_MS = 3_000
const STALE_CHECK_MS = 5 * 60_000
const STALE_JOB_MINUTES = 15
const PROVIDER_RETRY_DELAY_MS = 5 * 60_000
const MAX_WORKER_CONCURRENCY = 1

function workerConcurrency(raw = process.env.GENERATION_WORKER_CONCURRENCY): number {
  const parsed = raw ? Number(raw) : 1
  return Number.isInteger(parsed) ? Math.min(MAX_WORKER_CONCURRENCY, Math.max(1, parsed)) : 1
}

const TEMPORARY_PROVIDER_FAILURES = new Set([
  'rate_limited',
  'timeout',
  'provider_unavailable',
  'provider_request_failed',
])

// Leitura de scan e OCR têm workers próprios. Mantê-los fora desta lista
// impede que uma imagem longa bloqueie geração, adaptação ou pontuação.
const GENERAL_JOB_TYPES = GENERATION_JOB_TYPES.filter((jobType) => jobType !== 'transcrever_scan' && jobType !== 'processar_scan')

// Scripts tsx fora do Next não carregam .env.local sozinhos (mesmo motivo
// do seed-pedagogical-taxonomies). O worker precisa do ambiente completo
// (DATABASE_URL, DEEPSEEK_API_KEY, chaves Google...), então carrega o
// arquivo inteiro — sem sobrescrever o que já veio do ambiente, que tem
// prioridade (padrão dotenv).
function loadLocalEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    if (process.env[key] !== undefined) continue
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
  }
}

let shuttingDown = false
let crashing = false
// Jobs em execução neste processo. Usado só pela rota de queda (ver
// handleFatalError) pra devolver à fila na hora, em vez de esperar a
// varredura de órfãos de 15min.
const activeJobs = new Map<number, ClaimedJob>()

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Best-effort, nunca derruba o loop — mesmo contrato dos outros gatilhos
// de Chat do projeto.
async function notifyRequester(job: ClaimedJob, label: string, outcome: 'concluido' | 'erro', examId?: number) {
  try {
    const requester = await db.query.users.findFirst({ where: eq(users.id, job.requestedBy), columns: { email: true } })
    if (!requester) return
    const examUrl = outcome === 'concluido' && examId ? `${process.env.NEXTAUTH_URL ?? ''}/gerar/${examId}/revisar` : undefined
    await sendChatGenerationJobNotification(requester.email, label, outcome, examUrl)
  } catch (err) {
    console.warn(`[worker] falha ao notificar solicitante do job #${job.id}:`, err instanceof Error ? err.message : err)
  }
}

function jobLabelFor(job: ClaimedJob): string {
  if (job.jobType === 'gerar_prova') {
    return gerarProvaJobLabel((job.payload ?? {}) as { subject?: string; gradeYear?: number; classLabel?: string })
  }
  return `${job.jobType} #${job.id}`
}

async function runOnce(job: ClaimedJob) {
  const label = jobLabelFor(job)
  console.log(`[worker] job #${job.id} (${job.jobType}) iniciado — ${label} [tentativa ${job.attempts}/${job.maxAttempts}]`)


  // Heartbeat a cada 20s impede que requeueStaleJobs marque o job como
  // travado durante uma geração longa porém legítima.
  const heartbeatInterval = setInterval(async () => {
    try { await heartbeatJob(job.id) } catch { /* best-effort, nunca derruba o job */ }
  }, 20_000)

  activeJobs.set(job.id, job)
  try {
    const result = await executeJob(job)
    await completeJob(job.id, { resultExamId: result.resultExamId, resultRef: result.resultRef })
    console.log(`[worker] job #${job.id} concluído${result.resultExamId ? ` (prova #${result.resultExamId})` : ''}`)
    if (result.notifyRequester) {
      await notifyRequester(job, result.label, 'concluido', result.resultExamId)
    }
  } catch (err) {
    const message = err instanceof StructuredGenerationError
      ? `[ia:${err.failureCode}] ${err.message}${err.issues.length ? ` Detalhe: ${[...new Set(err.issues)].slice(0, 3).join(' | ')}` : ''}`.slice(0, 1500)
      : err instanceof Error ? err.message : String(err)
    if (err instanceof AiBudgetExceededError) {
      const availableAt = nextAiBudgetWindowStart()
      await deferJobForAiBudget(job, availableAt, `${message} A geração será retomada automaticamente após ${availableAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`)
      console.warn(`[worker] job #${job.id} aguardando cota de ${err.purpose}; tentativa preservada.`)
      return
    }
    if (err instanceof JevUnavailableError && err.retryable) {
      const retryDelayMs = err.failure.retryAfterMs === null
        ? PROVIDER_RETRY_DELAY_MS
        : Math.min(60 * 60_000, Math.max(5_000, err.failure.retryAfterMs))
      const availableAt = new Date(Date.now() + retryDelayMs)
      await deferJobForProvider(job, availableAt, `${message} A fila tentará novamente após ${availableAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}; nenhuma tentativa de conteúdo foi consumida.`)
      console.warn(`[worker] job #${job.id} aguardando Jev (${err.failure.category}); tentativa preservada.`)
      return
    }
    if (err instanceof StructuredGenerationError && TEMPORARY_PROVIDER_FAILURES.has(err.failureCode)) {
      const availableAt = new Date(Date.now() + PROVIDER_RETRY_DELAY_MS)
      await deferJobForProvider(job, availableAt, `O provedor de IA recusou temporariamente a geração (${err.failureCode}). A atividade será retomada automaticamente após ${availableAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}; nenhuma tentativa foi consumida.`)
      console.warn(`[worker] job #${job.id} aguardando provedor (${err.failureCode}); tentativa preservada.`)
      return
    }
    const failureCode = err instanceof StructuredGenerationError ? err.failureCode : classifyAiFailure(err)
    const nextStatus = await failJob(job, message, !isPermanentAiProviderFailure(failureCode))
    console.error(`[worker] job #${job.id} falhou (${nextStatus === 'pendente' ? 'vai retentar' : 'erro definitivo'}): ${message}`)
    // Falha definitiva só vira DM em job disparado pelo usuário — job
    // interno (pontuar_prova) falhando fica no log e na aba da fila.
    if (nextStatus === 'erro' && job.jobType === 'gerar_prova') {
      await notifyRequester(job, label, 'erro')
    }
  } finally {
    clearInterval(heartbeatInterval)
    activeJobs.delete(job.id)
  }
}

// Erro assíncrono fora de qualquer try/catch (ex.: assert interno do undici
// quando o provedor fecha a conexão no meio da resposta — visto em produção
// 10/11/2026, job #24244). O estado do processo não é confiável depois disso,
// então o worker sai e o Docker reinicia; antes, devolve os jobs em execução à
// fila pelo caminho normal de falha (consome a tentativa, mesmo critério da
// varredura de órfãos), sem deixar o job parado em 'gerando' por 15min.
async function handleFatalError(kind: string, err: unknown) {
  console.error(`[worker] ${kind} — encerrando o worker:`, err)
  if (crashing) return
  crashing = true
  const message = `Execução interrompida por erro inesperado no worker (${err instanceof Error ? err.message : String(err)}); devolvido à fila automaticamente.`
  const requeue = Promise.allSettled([...activeJobs.values()].map(async (job) => {
    const nextStatus = await failJob(job, message, true)
    console.warn(`[worker] job #${job.id} devolvido após queda (${nextStatus === 'pendente' ? 'vai retentar' : 'erro definitivo'}).`)
  }))
  await Promise.race([requeue, sleep(5_000)])
  process.exit(1)
}

process.on('uncaughtException', (err) => { void handleFatalError('uncaughtException', err) })
process.on('unhandledRejection', (reason) => { void handleFatalError('unhandledRejection', reason) })

async function main() {
  loadLocalEnvFile()
  if (!process.env.DATABASE_URL) {
    console.error('[worker] DATABASE_URL não configurado (nem no ambiente, nem em .env.local) — abortando.')
    process.exit(1)
  }

  const concurrency = workerConcurrency()
  console.log('[worker] prova-tri-worker iniciado (poll a cada %dms, concorrência %d, jobs órfãos após %dmin)', POLL_MS, concurrency, STALE_JOB_MINUTES)

  // A heartbeat diferencia geração longa de job órfão; só jobs que pararam
  // de renovar por 15 minutos são devolvidos à fila.
  const recovered = await requeueStaleJobs(STALE_JOB_MINUTES)
  if (recovered.requeued || recovered.failed) {
    console.warn(`[worker] jobs órfãos na subida: ${recovered.requeued} reenfileirado(s), ${recovered.failed} marcado(s) como erro.`)
  }

  let lastStaleCheck = Date.now()
  const inFlight = new Map<number, Promise<void>>()
  while (!shuttingDown) {
    if (Date.now() - lastStaleCheck >= STALE_CHECK_MS) {
      lastStaleCheck = Date.now()
      try {
        await requeueStaleJobs(STALE_JOB_MINUTES)
      } catch (err) {
        console.warn('[worker] falha na varredura de jobs órfãos:', err instanceof Error ? err.message : err)
      }
    }
    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight.values())
      continue
    }
    let job: ClaimedJob | null = null
    try {
      job = await claimNextJob(GENERAL_JOB_TYPES)
    } catch (err) {
      // Banco fora do ar não pode matar o worker — espera e tenta de novo.
      console.error('[worker] falha no claim (banco indisponível?):', err instanceof Error ? err.message : err)
      await sleep(POLL_MS * 5)
      continue
    }

    if (!job) {
      if (inFlight.size) await Promise.race([...inFlight.values(), sleep(POLL_MS)])
      else await sleep(POLL_MS)
      continue
    }
    const jobId = job.id
    const execution = runOnce(job).finally(() => inFlight.delete(jobId))
    inFlight.set(jobId, execution)
  }

  await Promise.allSettled(inFlight.values())
  console.log('[worker] encerrado.')
  process.exit(0)
}

// Docker envia SIGTERM no stop/restart: termina o job em andamento e sai. Se o
// processo for morto no meio mesmo assim (SIGKILL após o período de parada),
// a varredura de jobs órfãos recupera na próxima subida.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} recebido — encerrando após o job atual...`)
    shuttingDown = true
  })
}

main().catch((err) => {
  console.error('[worker] erro fatal:', err)
  process.exit(1)
})
