'use client'

// Bloco 8.5 — indicadores do ano: professor (seus planejamentos),
// coordenação e escola (por segmento e por disciplina).

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { IndicatorSummary } from '@/lib/curriculum/operations'

type Row = IndicatorSummary & { label: string }
type PlanRow = { planId: number; subject: string; gradeYear: number; bimester: number; officialStatus: string | null; openStatus: string | null; plannedCount: number; evaluatedCount: number; coveragePercent: number | null; interventions: Array<{ status: string }> }
type Data = { academicYear: number; scope: 'escola' | 'professor'; summary: IndicatorSummary; bySegment: Row[]; bySubject: Row[]; plans: PlanRow[] }

function pct(value: number | null) { return value === null ? '—' : `${value}%` }

function Card({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return <div className="rounded border border-border bg-surface p-3"><p className="text-xs text-content-secondary">{label}</p><p className="mt-1 text-2xl font-semibold text-content-primary">{value}</p>{hint && <p className="text-xs text-content-muted">{hint}</p>}</div>
}

function GroupTable({ title, rows }: { title: string; rows: Row[] }) {
  if (!rows.length) return null
  return <div className="overflow-x-auto rounded border border-border bg-surface">
    <table className="w-full text-sm">
      <caption className="px-3 pt-3 text-left font-semibold text-content-primary">{title}</caption>
      <thead><tr className="border-b border-border text-left text-xs text-content-secondary"><th scope="col" className="px-3 py-2">Grupo</th><th scope="col" className="px-3 py-2 text-right">Planejamentos</th><th scope="col" className="px-3 py-2 text-right">Aprovados</th><th scope="col" className="px-3 py-2 text-right">Em revisão</th><th scope="col" className="px-3 py-2 text-right">Cobertura</th><th scope="col" className="px-3 py-2 text-right">Intervenções abertas</th><th scope="col" className="px-3 py-2 text-right">Atrasadas</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.label} className="border-b border-border last:border-0 tabular-nums"><td className="px-3 py-2 font-medium text-content-primary">{row.label}</td><td className="px-3 py-2 text-right">{row.planCount}</td><td className="px-3 py-2 text-right">{row.approvedCount}</td><td className="px-3 py-2 text-right">{row.inReviewCount}</td><td className="px-3 py-2 text-right">{pct(row.coveragePercent)}</td><td className="px-3 py-2 text-right">{row.interventionsOpen}</td><td className={`px-3 py-2 text-right ${row.interventionsOverdue ? 'font-semibold text-status-danger-content' : ''}`}>{row.interventionsOverdue}</td></tr>)}</tbody>
    </table>
  </div>
}

export default function PlanningIndicators() {
  const currentYear = new Date().getFullYear()
  const [academicYear, setAcademicYear] = useState(currentYear)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setData(null)
    void fetch(`/api/curriculum/indicators?academicYear=${academicYear}`).then(async (response) => {
      const body = await response.json()
      if (!active) return
      if (!response.ok) setError(body.error ?? 'Não foi possível carregar os indicadores.')
      else { setError(null); setData(body) }
    })
    return () => { active = false }
  }, [academicYear])

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-content-secondary">{data?.scope === 'professor' ? 'Seus planejamentos atribuídos.' : 'Escola inteira.'} Cobertura = habilidades planejadas com ao menos uma resposta corrigida.</p>
      <select aria-label="Ano letivo dos indicadores" value={academicYear} onChange={(e) => setAcademicYear(Number(e.target.value))} className="rounded border border-border bg-canvas px-2 py-1.5 text-sm">{[currentYear + 1, currentYear, currentYear - 1].map((year) => <option key={year} value={year}>{year}</option>)}</select>
    </div>
    {error ? <p className="rounded bg-status-warning-surface p-3 text-sm text-status-warning-content">{error}</p>
      : !data ? <p className="text-sm text-content-secondary">Carregando indicadores…</p>
      : !data.summary.planCount ? <p className="rounded border border-border bg-surface p-4 text-sm text-content-secondary">Nenhum planejamento em {data.academicYear}.</p>
      : <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card label="Planejamentos aprovados" value={`${data.summary.approvedCount}/${data.summary.planCount}`} hint={`${data.summary.inReviewCount} em revisão · ${data.summary.draftOnlyCount} só em rascunho`} />
          <Card label="Cobertura do planejado" value={pct(data.summary.coveragePercent)} hint={`${data.summary.evaluatedSkillCount} de ${data.summary.plannedSkillCount} habilidades avaliadas`} />
          <Card label="Intervenções abertas" value={data.summary.interventionsOpen} hint={`${data.summary.interventionsDone} concluída(s)`} />
          <Card label="Intervenções atrasadas" value={data.summary.interventionsOverdue} />
        </div>
        <GroupTable title="Por segmento" rows={data.bySegment} />
        <GroupTable title="Por disciplina" rows={data.bySubject} />
        <div className="overflow-x-auto rounded border border-border bg-surface">
          <table className="w-full text-sm">
            <caption className="px-3 pt-3 text-left font-semibold text-content-primary">Por planejamento</caption>
            <thead><tr className="border-b border-border text-left text-xs text-content-secondary"><th scope="col" className="px-3 py-2">Disciplina</th><th scope="col" className="px-3 py-2">Série</th><th scope="col" className="px-3 py-2">Bim.</th><th scope="col" className="px-3 py-2">Situação</th><th scope="col" className="px-3 py-2 text-right">Cobertura</th><th scope="col" className="px-3 py-2"><span className="sr-only">Abrir</span></th></tr></thead>
            <tbody>{data.plans.map((plan) => <tr key={plan.planId} className="border-b border-border last:border-0 tabular-nums"><td className="px-3 py-2 font-medium text-content-primary">{plan.subject}</td><td className="px-3 py-2">{plan.gradeYear}º ano</td><td className="px-3 py-2">{plan.bimester}º</td><td className="px-3 py-2 text-xs">{plan.officialStatus ?? (plan.openStatus === 'em_revisao' ? 'em revisão' : 'rascunho')}</td><td className="px-3 py-2 text-right">{pct(plan.coveragePercent)} <span className="text-xs text-content-muted">({plan.evaluatedCount}/{plan.plannedCount})</span></td><td className="px-3 py-2 text-right"><Link href={`/planejamento/${plan.planId}`} className="font-medium text-harmonia-green hover:underline">Abrir</Link></td></tr>)}</tbody>
          </table>
        </div>
      </>}
  </div>
}
