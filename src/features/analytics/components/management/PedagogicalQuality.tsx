import { RechartsBarChart } from '@/app/(app)/dashboard/charts/RechartsBarChart'
import { toBloomDistribution } from '@/features/analytics/model/dashboard-selectors'
import type { DashboardStats } from '@/features/analytics/types/dashboard'

export function PedagogicalQuality({ stats }: { stats: DashboardStats }) {
  const bloom = toBloomDistribution(stats)
  return (
    <section aria-labelledby="pedagogical-quality-title" className="space-y-4">
      <div><p className="text-xs font-bold uppercase tracking-wider text-content-muted">Qualidade pedagógica</p><h2 id="pedagogical-quality-title" className="mt-1 text-xl font-bold tracking-tight text-content-primary">Cobertura e complexidade</h2></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <RechartsBarChart title="Distribuição de Bloom" subtitle="Quantidade acumulada de questões por nível cognitivo." colors={['#c8e6d3','#a0d1b5','#6fb98f','#3fa06a','#1f8850','#008649']} categories={bloom.map((item) => item.label)} values={bloom.map((item) => item.value)} />
        <div className="rounded-lg border border-border bg-surface p-4"><p className="text-sm font-semibold text-content-primary">Cobertura BNCC e imagens</p><p className="mt-2 text-sm text-content-secondary"><strong className="text-content-primary">{stats.bnccMappedPct}%</strong> das questões geradas possuem mapeamento BNCC.</p><p className="mt-2 text-sm text-content-secondary"><strong className="text-content-primary">{stats.questionsNeedingImage}</strong> questões solicitaram imagem; <strong className="text-content-primary">{stats.imagesApproved}</strong> imagens foram aprovadas.</p></div>
      </div>
    </section>
  )
}
