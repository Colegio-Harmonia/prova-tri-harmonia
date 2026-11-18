import type { RecoveryRoundStatus } from '@/db/schema'

export const ROUND_STATUS_LABELS: Record<RecoveryRoundStatus, string> = {
  aberto: 'Em preparação',
  em_aprovacao: 'Aguardando coordenação',
  aprovado: 'Pronto para imprimir',
  impresso: 'Impresso',
}

export const ROUND_STATUS_TONES: Record<RecoveryRoundStatus, string> = {
  aberto: 'bg-surface-subtle text-content-secondary',
  em_aprovacao: 'bg-status-warning-surface text-status-warning-content',
  aprovado: 'bg-status-info-surface text-status-info-content',
  impresso: 'bg-status-success-surface text-status-success-content',
}
