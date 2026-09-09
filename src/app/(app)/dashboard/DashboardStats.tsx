'use client'

import { useQuery } from '@tanstack/react-query'
import { dashboardStatsQueryOptions } from '@/features/analytics/queries/dashboard-stats'
import { ManagementOverview } from '@/features/analytics/components/management/ManagementOverview'
import { ProductionComposition } from '@/features/analytics/components/management/ProductionComposition'
import { PedagogicalQuality } from '@/features/analytics/components/management/PedagogicalQuality'
import { ApiError } from '@/lib/api/client'
import { ApexBarChart } from './charts/ApexBarChart'

// Light→dark green ramp, ordinal (cognitive complexity low→high), anchored on
// the brand green (#008649) as the terminal/highest step.
function toChartData(data: Record<string, number>, order?: string[]): { categories: string[]; values: number[] } {
  const entries = order
    ? order.filter((k) => k in data).map((k) => [k, data[k]] as const)
    : Object.entries(data).sort((a, b) => b[1] - a[1])
  return { categories: entries.map(([k]) => k), values: entries.map(([, v]) => v) }
}


export default function DashboardStats() {
  const { data: stats, error, isPending } = useQuery(dashboardStatsQueryOptions)

  if (error) {
    return (
      <p className="text-sm text-red-600">
        {error instanceof ApiError ? error.message : 'Falha ao carregar estatísticas.'}
      </p>
    )
  }
  if (isPending || !stats) return <p className="text-sm text-neutral-500">Carregando…</p>

  if (stats.total === 0) {
    return (
      <div className="rounded border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        Nenhuma prova gerada ainda. Assim que você gerar a primeira, as estatísticas aparecem aqui.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <ManagementOverview stats={stats} />

      <ProductionComposition stats={stats} />
      <PedagogicalQuality stats={stats} />
    </div>
  )
}
