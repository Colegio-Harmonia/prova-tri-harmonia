import { RechartsBarChart } from '@/app/(app)/dashboard/charts/RechartsBarChart'
import { toDistribution } from '@/features/analytics/model/dashboard-selectors'
import type { DashboardStats } from '@/features/analytics/types/dashboard'

type ProductionCompositionProps = { stats: DashboardStats }

function chartData(data: Record<string, number>, limit?: number) {
  const entries = toDistribution(data).slice(0, limit)
  return { categories: entries.map((entry) => entry.label), values: entries.map((entry) => entry.value) }
}

export function ProductionComposition({ stats }: ProductionCompositionProps) {
  const grades = toDistribution(stats.byGrade).sort((a, b) => Number.parseInt(a.label) - Number.parseInt(b.label))

  return (
    <section aria-labelledby="dashboard-composition-title" className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-content-muted">Composição</p>
        <h2 id="dashboard-composition-title" className="mt-1 text-xl font-bold tracking-tight text-content-primary">Distribuição da produção</h2>
        <p className="mt-1 text-sm text-content-muted">Quantidade acumulada de provas por segmento, série e disciplina.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <RechartsBarChart title="Por segmento" colors="#008649" {...chartData(stats.bySegment)} />
        <RechartsBarChart title="Por série" colors="#008649" categories={grades.map((entry) => entry.label)} values={grades.map((entry) => entry.value)} />
        <RechartsBarChart title="Por disciplina" colors="#008649" {...chartData(stats.bySubject, 8)} />
      </div>
    </section>
  )
}
