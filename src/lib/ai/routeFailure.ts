import { NextResponse } from 'next/server'
import { AiBudgetExceededError } from './operationBudget'
import { StructuredGenerationError } from '@/lib/gemini/structuredRepair'

const UNAVAILABLE_CODES = new Set([
  'timeout',
  'rate_limited',
  'provider_auth',
  'provider_not_configured',
  'provider_not_implemented',
  'provider_unavailable',
  'provider_request_failed',
])

export function aiFailureResponse(error: unknown, invalidContentMessage: string) {
  if (error instanceof AiBudgetExceededError) {
    return NextResponse.json({ error: 'O limite diário de IA foi atingido. Nenhuma alteração foi salva; tente novamente amanhã ou solicite ajuste à coordenação.' }, { status: 429 })
  }

  if (error instanceof StructuredGenerationError && UNAVAILABLE_CODES.has(error.failureCode)) {
    return NextResponse.json({ error: 'A IA está indisponível no momento. Nenhuma alteração foi salva; tente novamente mais tarde.' }, { status: 503 })
  }

  return NextResponse.json({ error: invalidContentMessage }, { status: 502 })
}
