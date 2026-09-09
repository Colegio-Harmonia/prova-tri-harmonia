import type {
  DashboardStats,
  DistributionEntry,
  ManagementAttention,
  ManagementSummary,
} from '@/features/analytics/types/dashboard'

export const BLOOM_ORDER = ['lembrar', 'compreender', 'aplicar', 'analisar', 'avaliar', 'criar'] as const

export const BLOOM_LABELS: Record<(typeof BLOOM_ORDER)[number], string> = {
  lembrar: 'Lembrar',
  compreender: 'Compreender',
  aplicar: 'Aplicar',
  analisar: 'Analisar',
  avaliar: 'Avaliar',
  criar: 'Criar',
}

export function getManagementSummary(stats: DashboardStats): ManagementSummary {
  return {
    totalExams: stats.total,
    totalQuestions: stats.totalQuestions,
    bnccMappedPct: stats.bnccMappedPct,
    pendingReview: stats.byStatus.revisao_concluida ?? 0,
  }
}

export function getManagementAttention(stats: DashboardStats): ManagementAttention | null {
  const pendingReview = stats.byStatus.revisao_concluida ?? 0
  if (pendingReview > 0) {
    return {
      label: 'Revisões aguardando aprovação',
      detail: 'Provas com revisão concluída aguardam a próxima decisão.',
      value: pendingReview,
      href: '/status',
    }
  }

  const pendingImages = Math.max(stats.questionsNeedingImage - stats.imagesApproved, 0)
  if (pendingImages > 0) {
    return {
      label: 'Imagens aguardando aprovação',
      detail: 'Questões que solicitaram imagem ainda não possuem imagem aprovada.',
      value: pendingImages,
      href: '/status',
    }
  }

  return null
}

export function toDistribution(data: Record<string, number>, order?: readonly string[]): DistributionEntry[] {
  const entries = order
    ? order.filter((key) => key in data).map((key) => ({ label: key, value: data[key] ?? 0 }))
    : Object.entries(data)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'pt-BR'))

  return entries
}

export function toBloomDistribution(stats: DashboardStats): DistributionEntry[] {
  return BLOOM_ORDER.map((level) => ({
    label: BLOOM_LABELS[level],
    value: stats.bloomCounts[level] ?? 0,
  }))
}
