'use client'

// Bloco 8 — operação do bimestre dentro do planejamento: cobertura, turma por
// habilidade, sugestões, intervenções ligadas a habilidades e histórico.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { SkillSignal, Suggestion } from '@/lib/curriculum/operations'

type Intervention = { id: number; action: string; ownerName: string; dueDate: string | null; status: 'planejada' | 'em_andamento' | 'concluida'; skillCodes: string[]; bimester: number | null; createdAt: string }
type Decision = { id: number; action: string; summary: string; createdAt: string; actor: string }
type Data = { examCount: number; signals: SkillSignal[]; suggestions: Suggestion[]; interventions: Intervention[]; decisions: Decision[]; rules: { retakeBelowPercent: number } }
type Plan = { id: number; academicYear: number; segment: string; gradeYear: number; subject: string; bimester: number }

const button = 'rounded border border-border px-3 py-1.5 text-sm font-medium text-content-primary hover:bg-surface-subtle disabled:opacity-50'
const primary = 'rounded bg-harmonia-green px-3 py-1.5 text-sm font-semibold text-action-primary-foreground disabled:opacity-50'
const input = 'rounded border border-border bg-canvas px-2 py-1.5 text-sm'
const STATUS_LABEL = { planejada: 'Planejada', em_andamento: 'Em andamento', concluida: 'Concluída' } as const

function pct(value: number | null) { return value === null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` }

function InterventionForm({ plan, codes, allCodes, onDone }: { plan: Plan; codes: string[]; allCodes: string[]; onDone: (message: string) => void }) {
  const [action, setAction] = useState(codes.length ? `Retomada de ${codes.join(', ')}` : '')
  const [ownerName, setOwnerName] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set(codes))
  const [busy, setBusy] = useState(false)
  async function submit() {
    setBusy(true)
    const response = await fetch('/api/analytics/interventions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segment: plan.segment, gradeYear: plan.gradeYear, subject: plan.subject, academicYear: plan.academicYear, bimester: plan.bimester, skillCodes: [...selected], action, ownerName, dueDate }) })
    const body = await response.json(); setBusy(false)
    onDone(response.ok ? 'Intervenção registrada.' : body.error ?? 'Não foi possível registrar.')
  }
  return <div className="mt-2 space-y-2 rounded border border-border bg-surface-subtle p-3">
    <input aria-label="Ação" placeholder="Ação de retomada (ex.: oficina com material concreto)" value={action} onChange={(e) => setAction(e.target.value)} className={`${input} w-full`} />
    <div className="flex flex-wrap gap-2">
      <input aria-label="Responsável" placeholder="Responsável" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className={`${input} flex-1`} />
      <input aria-label="Prazo" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={input} />
    </div>
    <fieldset className="flex flex-wrap gap-x-3 gap-y-1 text-xs"><legend className="mb-1 text-content-secondary">Habilidades retomadas (nenhuma = disciplina inteira)</legend>
      {allCodes.map((code) => <label key={code} className="flex items-center gap-1 font-mono"><input type="checkbox" checked={selected.has(code)} onChange={(e) => { const next = new Set(selected); if (e.target.checked) next.add(code); else next.delete(code); setSelected(next) }} />{code}</label>)}
    </fieldset>
    <button type="button" disabled={busy || !action.trim() || !ownerName.trim()} onClick={submit} className={primary}>{busy ? 'Registrando…' : 'Registrar intervenção'}</button>
  </div>
}

export default function PlanOperations({ plan, canManage }: { plan: Plan; canManage: boolean }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [formFor, setFormFor] = useState<string[] | null>(null)

  const load = useCallback(async () => {
    const response = await fetch(`/api/curriculum/plans/${plan.id}/operations`)
    const body = await response.json()
    if (!response.ok) setError(body.error ?? 'Não foi possível carregar a operação do bimestre.')
    else { setError(null); setData(body) }
  }, [plan.id])
  useEffect(() => { void load() }, [load])

  async function setStatus(id: number, status: Intervention['status']) {
    const response = await fetch('/api/analytics/interventions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) })
    if (!response.ok) setMessage((await response.json()).error ?? 'Não foi possível atualizar.')
    await load()
  }

  if (error) return <section className="rounded border border-border bg-surface p-4 text-sm text-status-warning-content">{error}</section>
  if (!data) return <section className="rounded border border-border bg-surface p-4 text-sm text-content-secondary">Carregando operação do bimestre…</section>

  const planned = data.signals.filter((signal) => signal.planned)
  const evaluated = planned.filter((signal) => signal.evaluated)
  const pending = planned.filter((signal) => !signal.evaluated)
  const outside = data.signals.filter((signal) => !signal.planned)
  const plannedCodes = planned.map((signal) => signal.code)

  return <section className="space-y-4 rounded border border-border bg-surface p-4">
    <div>
      <h2 className="font-semibold text-content-primary">Operação do bimestre</h2>
      <p className="mt-1 text-sm text-content-secondary">Cruza a versão oficial do planejamento com as {data.examCount} prova(s) do recorte e as correções revisadas.</p>
    </div>
    {message && <p role="status" className="rounded bg-surface-subtle p-2 text-sm text-content-secondary">{message}</p>}

    <div>
      <h3 className="text-sm font-semibold text-content-primary">Cobertura: {evaluated.length} de {planned.length} habilidades planejadas já avaliadas</h3>
      <div className="mt-1 h-2 rounded bg-surface-subtle"><div className="h-2 rounded bg-harmonia-green" style={{ width: `${planned.length ? (evaluated.length / planned.length) * 100 : 0}%` }} /></div>
      {pending.length > 0 && <p className="mt-2 text-sm text-status-warning-content"><span className="font-semibold">Ainda não avaliadas no bimestre:</span> {pending.map((signal) => signal.code).join(', ')}</p>}
      {outside.length > 0 && <p className="mt-1 text-xs text-content-muted">Avaliadas fora do planejamento: {outside.map((signal) => signal.code).join(', ')}</p>}
      {evaluated.length > 0 && <div className="mt-2 overflow-x-auto"><table className="w-full text-sm">
        <caption className="sr-only">Aproveitamento da turma por habilidade planejada</caption>
        <thead><tr className="text-left text-xs text-content-secondary"><th scope="col" className="py-1 pr-2">Habilidade</th><th scope="col" className="py-1 pr-2 text-right">Aproveit. (turma)</th><th scope="col" className="py-1 pr-2 text-right">Respostas</th><th scope="col" className="py-1 text-right">Alunos</th></tr></thead>
        <tbody>{evaluated.map((signal) => <tr key={signal.code} className="border-t border-border tabular-nums"><td className="py-1 pr-2 font-mono" title={signal.description ?? undefined}>{signal.code}</td><td className={`py-1 pr-2 text-right ${signal.percent !== null && signal.percent < data.rules.retakeBelowPercent ? 'font-semibold text-status-danger-content' : ''}`}>{pct(signal.percent)}</td><td className="py-1 pr-2 text-right">{signal.itemCount}</td><td className="py-1 text-right">{signal.studentCount}</td></tr>)}</tbody>
      </table></div>}
    </div>

    <div>
      <h3 className="text-sm font-semibold text-content-primary">Sugestões</h3>
      {data.suggestions.length ? <ul className="mt-2 space-y-2">{data.suggestions.map((suggestion) => <li key={suggestion.kind} className="rounded border border-border p-3 text-sm">
        <p className="font-medium text-content-primary">{suggestion.title}</p>
        <p className="mt-1 text-xs text-content-secondary">{suggestion.reason}</p>
        <p className="mt-1 font-mono text-xs">{suggestion.codes.join(', ')}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {suggestion.kind === 'avaliar'
            ? <Link href="/gerar" className={button}>Gerar avaliação</Link>
            : <Link href="/atividades" className={button}>Gerar atividade de retomada</Link>}
          {canManage && <button type="button" onClick={() => setFormFor(formFor === suggestion.codes ? null : suggestion.codes)} className={button}>Registrar intervenção</button>}
        </div>
        {canManage && formFor === suggestion.codes && <InterventionForm plan={plan} codes={suggestion.codes} allCodes={plannedCodes} onDone={(text) => { setMessage(text); setFormFor(null); void load() }} />}
      </li>)}</ul> : <p className="mt-1 text-sm text-content-muted">Nenhuma sugestão: habilidades planejadas avaliadas e sem aproveitamento abaixo de {data.rules.retakeBelowPercent}% com amostra suficiente.</p>}
      <p className="mt-1 text-xs text-content-muted">Nas telas de geração, escolha os capítulos que trabalham as habilidades listadas.</p>
    </div>

    <div>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-content-primary">Intervenções</h3>
        {canManage && <button type="button" onClick={() => setFormFor(formFor?.length === 0 ? null : [])} className={button}>+ Intervenção</button>}
      </div>
      {canManage && formFor?.length === 0 && <InterventionForm plan={plan} codes={[]} allCodes={plannedCodes} onDone={(text) => { setMessage(text); setFormFor(null); void load() }} />}
      {data.interventions.length ? <ul className="mt-2 space-y-2">{data.interventions.map((item) => <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 rounded border border-border p-2 text-sm">
        <div><p className="font-medium text-content-primary">{item.action}</p><p className="text-xs text-content-secondary">{item.ownerName}{item.dueDate ? ` · prazo ${new Date(`${item.dueDate}T12:00:00`).toLocaleDateString('pt-BR')}` : ''} · {item.skillCodes.length ? item.skillCodes.join(', ') : 'disciplina inteira'}</p></div>
        {canManage ? <select aria-label={`Situação de ${item.action}`} value={item.status} onChange={(e) => setStatus(item.id, e.target.value as Intervention['status'])} className={input}>{Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <span className="text-xs text-content-secondary">{STATUS_LABEL[item.status]}</span>}
      </li>)}</ul> : <p className="mt-1 text-sm text-content-muted">Nenhuma intervenção registrada para este recorte.</p>}
    </div>

    <div>
      <h3 className="text-sm font-semibold text-content-primary">Histórico de decisões</h3>
      {data.decisions.length ? <ol className="mt-2 max-h-80 space-y-2 overflow-y-auto text-sm">{data.decisions.map((decision) => <li key={decision.id}><p className="text-content-primary">{decision.summary}</p><p className="text-xs text-content-muted">{decision.actor} · {new Date(decision.createdAt).toLocaleString('pt-BR')}</p></li>)}</ol> : <p className="mt-1 text-sm text-content-muted">Sem decisões registradas ainda.</p>}
    </div>
  </section>
}
