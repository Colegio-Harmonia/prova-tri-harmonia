/**
 * Worker da fila de geração (Subtarefa 1a, 24/07/2026) — serviço Docker
 * separado (`worker`, ver docker-compose.yml). Consome
 * `generation_jobs` via claim atômico (FOR UPDATE SKIP LOCKED) e executa
 * os handlers de src/lib/queue/handlers.ts.
 *
 * Concorrência 1 de propósito: DeepSeek tem rate limit e o servidor é
 * caseiro — paralelismo é um parâmetro pra revisitar, não uma reescrita.
 *
 * Rodar: npm run worker (produção: Docker Compose; dev: direto no terminal).
 */
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { GENERATION_JOB_TYPES, users } from '../src/db/schema'
import { claimNextJob, completeJob, deferJobForAiBudget, failJob, requeueStaleJobs, type ClaimedJob } from '../src/lib/queue/claim'
import { executeJob, gerarProvaJobLabel } from '../src/lib/queue/handlers'
import { AiBudgetExceededError, nextAiBudgetWindowStart } from '../src/lib/ai/operationBudget'
import { sendChatGenerationJobNotification } from '../src/lib/notifications/googleChat'

const POLL_MS = 3_000
const STALE_CHECK_MS = 5 * 60_000
const STALE_JOB_MINUTES = 15

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

  try {
    const result = await executeJob(job)
    await completeJob(job.id, { resultExamId: result.resultExamId, resultRef: result.resultRef })
    console.log(`[worker] job #${job.id} concluído${result.resultExamId ? ` (prova #${result.resultExamId})` : ''}`)
    if (result.notifyRequester) {
      await notifyRequester(job, result.label, 'concluido', result.resultExamId)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof AiBudgetExceededError) {
      const availableAt = nextAiBudgetWindowStart()
      await deferJobForAiBudget(job, availableAt, `${message} A geração será retomada automaticamente após ${availableAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`)
      console.warn(`[worker] job #${job.id} aguardando cota de ${err.purpose}; tentativa preservada.`)
      return
    }
    const nextStatus = await failJob(job, message)
    console.error(`[worker] job #${job.id} falhou (${nextStatus === 'pendente' ? 'vai retentar' : 'erro definitivo'}): ${message}`)
    // Falha definitiva só vira DM em job disparado pelo usuário — job
    // interno (pontuar_prova) falhando fica no log e na aba da fila.
    if (nextStatus === 'erro' && job.jobType === 'gerar_prova') {
      await notifyRequester(job, label, 'erro')
    }
  }
}

async function main() {
  loadLocalEnvFile()
  if (!process.env.DATABASE_URL) {
    console.error('[worker] DATABASE_URL não configurado (nem no ambiente, nem em .env.local) — abortando.')
    process.exit(1)
  }

  console.log('[worker] prova-tri-worker iniciado (poll a cada %dms, jobs órfãos após %dmin)', POLL_MS, STALE_JOB_MINUTES)

  // Recuperação de crash na subida: devolve pra fila o que ficou preso em
  // 'gerando' quando o processo anterior morreu no meio.
  const recovered = await requeueStaleJobs(STALE_JOB_MINUTES)
  if (recovered.requeued || recovered.failed) {
    console.warn(`[worker] jobs órfãos na subida: ${recovered.requeued} reenfileirado(s), ${recovered.failed} marcado(s) como erro.`)
  }

  let lastStaleCheck = Date.now()
  while (!shuttingDown) {
    if (Date.now() - lastStaleCheck >= STALE_CHECK_MS) {
      lastStaleCheck = Date.now()
      try {
        await requeueStaleJobs(STALE_JOB_MINUTES)
      } catch (err) {
        console.warn('[worker] falha na varredura de jobs órfãos:', err instanceof Error ? err.message : err)
      }
    }

    let job: ClaimedJob | null = null
    try {
      job = await claimNextJob(GENERATION_JOB_TYPES.filter((jobType) => jobType !== 'transcrever_scan'))
    } catch (err) {
      // Banco fora do ar não pode matar o worker — espera e tenta de novo.
      console.error('[worker] falha no claim (banco indisponível?):', err instanceof Error ? err.message : err)
      await sleep(POLL_MS * 5)
      continue
    }

    if (!job) {
      await sleep(POLL_MS)
      continue
    }
    await runOnce(job)
  }

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
