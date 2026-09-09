import Link from 'next/link'
import { BookOpenCheck, ClipboardList, FileText, ListChecks } from 'lucide-react'
import React from 'react'
import { getManagementAttention, getManagementSummary } from '@/features/analytics/model/dashboard-selectors'
import type { DashboardStats } from '@/features/analytics/types/dashboard'

type ManagementOverviewProps = {
  stats: DashboardStats
}

const numberFormatter = new Intl.NumberFormat('pt-BR')

export function ManagementOverview({ stats }: ManagementOverviewProps) {
  const summary = getManagementSummary(stats)
  const attention = getManagementAttention(stats)
  const cards = [
    { label: 'Provas geradas', value: summary.totalExams, detail: 'volume acumulado', icon: ClipboardList },
    { label: 'Questões geradas', value: summary.totalQuestions, detail: 'itens no acervo gerado', icon: FileText },
    { label: 'Cobertura BNCC', value: `${summary.bnccMappedPct}%`, detail: 'questões mapeadas', icon: BookOpenCheck },
    { label: 'Aguardando aprovação', value: summary.pendingReview, detail: 'revisões concluídas', icon: ListChecks },
  ]

  return (
    <section aria-labelledby="management-overview-title" className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-content-muted">Panorama institucional</p>
          <h2 id="management-overview-title" className="mt-1 text-2xl font-bold tracking-tight text-content-primary">Visão institucional</h2>
        </div>
        <p className="text-sm text-content-muted">Dados acumulados de todas as provas geradas.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, detail, icon: Icon }) => (
          <article key={label} className="rounded-lg border border-border bg-surface p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-content-secondary">{label}</p>
              <Icon aria-hidden="true" className="h-5 w-5 text-harmonia-green" strokeWidth={1.8} />
            </div>
            <p className="mt-3 text-3xl font-bold tracking-tight text-content-primary">
              {typeof value === 'number' ? numberFormatter.format(value) : value}
            </p>
            <p className="mt-1 text-xs text-content-muted">{detail}</p>
          </article>
        ))}
      </div>

      <aside className="rounded-lg border border-border bg-surface-subtle p-4" aria-labelledby="management-attention-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p id="management-attention-title" className="text-sm font-semibold text-content-primary">Atenção agora</p>
            {attention ? (
              <p className="mt-1 text-sm text-content-secondary">
                <span className="font-semibold text-content-primary">{numberFormatter.format(attention.value)} {attention.label.toLowerCase()}.</span>{' '}
                {attention.detail}
              </p>
            ) : (
              <p className="mt-1 text-sm text-content-secondary">Não há revisões concluídas ou imagens pendentes registradas neste momento.</p>
            )}
          </div>
          {attention && (
            <Link href={attention.href} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-md bg-action-primary px-4 text-sm font-semibold text-action-primary-foreground transition-colors hover:brightness-95 focus-visible:outline-none">
              Ver provas
            </Link>
          )}
        </div>
      </aside>
    </section>
  )
}
