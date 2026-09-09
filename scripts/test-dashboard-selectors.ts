import assert from 'node:assert/strict'
import {
  BLOOM_LABELS,
  BLOOM_ORDER,
  getManagementAttention,
  getManagementSummary,
  toBloomDistribution,
  toDistribution,
} from '../src/features/analytics/model/dashboard-selectors'
import type { DashboardStats } from '../src/features/analytics/types/dashboard'

const stats: DashboardStats = {
  total: 12,
  byStatus: { revisao_concluida: 3, aprovado: 4 },
  bySegment: { 'Anos Finais': 12 },
  byGrade: { '8º ano': 12 },
  bySubject: { Inglês: 8, História: 4 },
  bloomCounts: { lembrar: 2, analisar: 5 },
  totalQuestions: 96,
  bnccMappedPct: 81,
  questionsNeedingImage: 4,
  imagesApproved: 1,
}

function run() {
  assert.deepEqual(getManagementSummary(stats), {
    totalExams: 12,
    totalQuestions: 96,
    bnccMappedPct: 81,
    pendingReview: 3,
  })

  assert.deepEqual(getManagementAttention(stats), {
    label: 'Revisões aguardando aprovação',
    detail: 'Provas com revisão concluída aguardam a próxima decisão.',
    value: 3,
    href: '/status',
  })

  assert.deepEqual(getManagementAttention({ ...stats, byStatus: {}, imagesApproved: 1 }), {
    label: 'Imagens aguardando aprovação',
    detail: 'Questões que solicitaram imagem ainda não possuem imagem aprovada.',
    value: 3,
    href: '/status',
  })
  assert.equal(getManagementAttention({ ...stats, byStatus: {}, imagesApproved: 4 }), null)

  assert.deepEqual(toDistribution({ Beta: 2, Alfa: 2, Gama: 5 }), [
    { label: 'Gama', value: 5 },
    { label: 'Alfa', value: 2 },
    { label: 'Beta', value: 2 },
  ])
  assert.deepEqual(toDistribution({ A: 1, B: 2 }, ['A', 'Ausente', 'B']), [
    { label: 'A', value: 1 },
    { label: 'B', value: 2 },
  ])

  assert.deepEqual(toBloomDistribution(stats), BLOOM_ORDER.map((level) => ({
    label: BLOOM_LABELS[level],
    value: stats.bloomCounts[level] ?? 0,
  })))
}

run()
console.log('Dashboard selector checks passed.')
