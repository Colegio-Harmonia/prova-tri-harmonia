import type { CorrectionAnswer } from '@/types/correction'

/**
 * JSONB de correções antigas pode conter um objeto em vez da lista esperada.
 * Consumidores devem usar esta normalização antes de chamar map/filter.
 */
export function normalizeCorrectionAnswers(value: unknown): CorrectionAnswer[] {
  return Array.isArray(value) ? value as CorrectionAnswer[] : []
}
