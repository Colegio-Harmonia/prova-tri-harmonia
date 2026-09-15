import type { StageId } from './types'

/**
 * Instrumentação por estágio/gate/disciplina/domínio. Mantida em memória do
 * processo (worker/rota) e emitida em log estruturado a cada evento — dá para
 * identificar lacunas de cobertura (ex.: um domínio que sempre rejeita) sem
 * esperar uma prova inteira falhar em produção.
 */
type Bucket = Map<string, number>

const attemptsByStage: Bucket = new Map()
const failuresByStage: Bucket = new Map()
const rejectionsByGate: Bucket = new Map()

function bump(bucket: Bucket, key: string) {
  bucket.set(key, (bucket.get(key) ?? 0) + 1)
}

function log(event: Record<string, unknown>) {
  try {
    console.info(JSON.stringify({ scope: 'generation-pipeline', ...event }))
  } catch {
    // Nunca deixe telemetria derrubar a geração.
  }
}

export function recordStageAttempt(stage: StageId, subject: string, domain?: string) {
  const key = [stage, subject, domain ?? '-'].join('|')
  bump(attemptsByStage, key)
  log({ event: 'stage_attempt', stage, subject, domain: domain ?? null })
}

export function recordStageFailure(stage: StageId, subject: string, reason: string, domain?: string) {
  const key = [stage, subject, domain ?? '-'].join('|')
  bump(failuresByStage, key)
  log({ event: 'stage_failure', stage, subject, domain: domain ?? null, reason })
}

export function recordGateRejection(stage: StageId, gate: string, subject: string, reason: string, domain?: string) {
  const key = [stage, gate, subject, domain ?? '-'].join('|')
  bump(rejectionsByGate, key)
  log({ event: 'gate_rejection', stage, gate, subject, domain: domain ?? null, reason })
}

export function generationMetricsSnapshot() {
  return {
    attemptsByStage: Object.fromEntries(attemptsByStage),
    failuresByStage: Object.fromEntries(failuresByStage),
    rejectionsByGate: Object.fromEntries(rejectionsByGate),
  }
}
