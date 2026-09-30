'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { SEGMENT_GRADES, SEGMENT_LABELS, SEGMENT_SUBJECTS } from '@/config/subjects'
import { PLANNING_STATUS_LABELS, type PlanningStatus } from '@/lib/curriculum/planningPolicy'
import type { Segment } from '@/types/exam'

type PlanRow = {
  id: number; academicYear: number; segment: Segment; gradeYear: number; subject: string; bimester: number
  official: { id: number; versionNumber: number; status: PlanningStatus } | null
  open: { id: number; versionNumber: number; status: PlanningStatus } | null
  versionCount: number; lastUpdate: string | null
  assignments: Array<{ userId: number; name: string; responsibility: string }>
}

const STATUS_CLASS: Record<PlanningStatus, string> = {
  rascunho: 'bg-surface-subtle text-content-secondary',
  em_revisao: 'bg-status-warning-surface text-status-warning-content',
  aprovado: 'bg-status-success-surface text-status-success-content',
  encerrado: 'bg-status-info-surface text-status-info-content',
}

export function StatusBadge({ status, versionNumber }: { status: PlanningStatus; versionNumber?: number }) {
  return <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>{PLANNING_STATUS_LABELS[status]}{versionNumber ? ` · v${versionNumber}` : ''}</span>
}

const input = 'rounded border border-border bg-canvas px-2 py-1.5 text-sm'
const button = 'rounded border border-border px-3 py-1.5 text-sm font-medium text-content-primary hover:bg-surface-subtle disabled:opacity-50'
const primary = 'rounded bg-harmonia-green px-3 py-1.5 text-sm font-semibold text-action-primary-foreground disabled:opacity-50'

function CreateForm({ onDone, defaultYear }: { onDone: (message: string, planId?: number) => void; defaultYear: number }) {
  const [segment, setSegment] = useState<Segment>('anos-iniciais')
  const [gradeYear, setGradeYear] = useState(5)
  const [subject, setSubject] = useState('Matemática')
  const [bimester, setBimester] = useState(1)
  const [academicYear, setAcademicYear] = useState(defaultYear)
  const [busy, setBusy] = useState(false)
  async function submit() {
    setBusy(true)
    const response = await fetch('/api/curriculum/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ academicYear, segment, gradeYear, subject, bimester }) })
    const body = await response.json(); setBusy(false)
    onDone(response.ok ? 'Planejamento criado em rascunho.' : body.error ?? 'Não foi possível criar.', response.ok ? body.planId : undefined)
  }
  return <div className="grid gap-2 rounded border border-border bg-surface p-3 sm:grid-cols-6">
    <input aria-label="Ano letivo" type="number" value={academicYear} onChange={(e) => setAcademicYear(Number(e.target.value))} className={input} />
    <select aria-label="Segmento" value={segment} onChange={(e) => { const value = e.target.value as Segment; setSegment(value); setGradeYear(SEGMENT_GRADES[value][0]); setSubject(SEGMENT_SUBJECTS[value][0]) }} className={input}>{Object.entries(SEGMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    <select aria-label="Série" value={gradeYear} onChange={(e) => setGradeYear(Number(e.target.value))} className={input}>{SEGMENT_GRADES[segment].map((grade) => <option key={grade} value={grade}>{grade}º ano</option>)}</select>
    <select aria-label="Disciplina" value={subject} onChange={(e) => setSubject(e.target.value)} className={input}>{SEGMENT_SUBJECTS[segment].map((item) => <option key={item}>{item}</option>)}</select>
    <select aria-label="Bimestre" value={bimester} onChange={(e) => setBimester(Number(e.target.value))} className={input}>{[1, 2, 3, 4].map((item) => <option key={item} value={item}>{item}º bimestre</option>)}</select>
    <button type="button" disabled={busy} onClick={submit} className={primary}>{busy ? 'Criando…' : 'Criar em rascunho'}</button>
  </div>
}

function CopyForm({ onDone, defaultYear }: { onDone: (message: string) => void; defaultYear: number }) {
  const [fromYear, setFromYear] = useState(defaultYear - 1)
  const [toYear, setToYear] = useState(defaultYear)
  const [busy, setBusy] = useState(false)
  async function submit() {
    if (!window.confirm(`Copiar todos os planejamentos aprovados de ${fromYear} como rascunhos de ${toYear}? Os responsáveis também são copiados; recortes que já existem em ${toYear} são mantidos.`)) return
    setBusy(true)
    const response = await fetch('/api/curriculum/plans/copy-year', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromYear, toYear }) })
    const body = await response.json(); setBusy(false)
    if (!response.ok) return onDone(body.error ?? 'Não foi possível copiar.')
    onDone(`${body.created.length} planejamento(s) copiado(s) para ${toYear}.${body.skipped.length ? ` Não copiados: ${body.skipped.join('; ')}.` : ''}`)
  }
  return <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-surface p-3 text-sm">
    <span>Copiar planejamentos aprovados de</span>
    <input aria-label="Ano de origem" type="number" value={fromYear} onChange={(e) => setFromYear(Number(e.target.value))} className={`${input} w-24`} />
    <span>para</span>
    <input aria-label="Ano de destino" type="number" value={toYear} onChange={(e) => setToYear(Number(e.target.value))} className={`${input} w-24`} />
    <button type="button" disabled={busy} onClick={submit} className={primary}>{busy ? 'Copiando…' : 'Copiar como rascunho'}</button>
  </div>
}

function CloseForm({ onDone, defaultYear }: { onDone: (message: string) => void; defaultYear: number }) {
  const [academicYear, setAcademicYear] = useState(defaultYear)
  const [bimester, setBimester] = useState(1)
  const [busy, setBusy] = useState(false)
  async function submit() {
    if (!window.confirm(`Encerrar o ${bimester}º bimestre de ${academicYear}? Os planejamentos aprovados ficam travados: alterações passam a exigir nova versão aberta pela coordenação, com justificativa.`)) return
    setBusy(true)
    const response = await fetch('/api/curriculum/plans/close-bimester', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ academicYear, bimester }) })
    const body = await response.json(); setBusy(false)
    if (!response.ok) return onDone(body.error ?? 'Não foi possível encerrar.')
    onDone(`${body.closed.length} planejamento(s) encerrado(s).${body.pending.length ? ` Pendentes (não encerrados): ${body.pending.join('; ')}.` : ''}`)
  }
  return <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-surface p-3 text-sm">
    <span>Encerrar o</span>
    <select aria-label="Bimestre a encerrar" value={bimester} onChange={(e) => setBimester(Number(e.target.value))} className={input}>{[1, 2, 3, 4].map((item) => <option key={item} value={item}>{item}º bimestre</option>)}</select>
    <span>de</span>
    <input aria-label="Ano letivo a encerrar" type="number" value={academicYear} onChange={(e) => setAcademicYear(Number(e.target.value))} className={`${input} w-24`} />
    <button type="button" disabled={busy} onClick={submit} className={button}>{busy ? 'Encerrando…' : 'Encerrar bimestre'}</button>
  </div>
}

export default function PlanningList({ isManager }: { isManager: boolean }) {
  const currentYear = new Date().getFullYear()
  const [academicYear, setAcademicYear] = useState<number | ''>('')
  const [segment, setSegment] = useState<Segment | ''>('')
  const [subject, setSubject] = useState('')
  const [plans, setPlans] = useState<PlanRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [panel, setPanel] = useState<'criar' | 'copiar' | 'encerrar' | null>(null)

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (academicYear) params.set('academicYear', String(academicYear))
    if (segment) params.set('segment', segment)
    if (subject) params.set('subject', subject)
    const response = await fetch(`/api/curriculum/plans?${params}`)
    const body = await response.json()
    if (!response.ok) { setError(body.error ?? 'Não foi possível carregar.'); return }
    setError(null); setPlans(body.plans)
  }, [academicYear, segment, subject])
  useEffect(() => { void load() }, [load])

  const years = [...new Set([currentYear + 1, currentYear, ...(plans ?? []).map((plan) => plan.academicYear)])].sort((a, b) => b - a)
  const subjects = [...new Set(segment ? SEGMENT_SUBJECTS[segment] : Object.values(SEGMENT_SUBJECTS).flat())].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  function done(text: string, planId?: number) {
    setMessage(text); setPanel(null); void load()
    if (planId) window.location.assign(`/planejamento/${planId}`)
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Filtrar ano letivo" value={academicYear} onChange={(e) => setAcademicYear(e.target.value ? Number(e.target.value) : '')} className={input}><option value="">Todos os anos</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select>
      <select aria-label="Filtrar segmento" value={segment} onChange={(e) => { setSegment(e.target.value as Segment | ''); setSubject('') }} className={input}><option value="">Todos os segmentos</option>{Object.entries(SEGMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="Filtrar disciplina" value={subject} onChange={(e) => setSubject(e.target.value)} className={input}><option value="">Todas as disciplinas</option>{subjects.map((item) => <option key={item}>{item}</option>)}</select>
      {isManager && <div className="ml-auto flex flex-wrap gap-2">
        <button type="button" onClick={() => setPanel(panel === 'criar' ? null : 'criar')} className={primary}>Novo planejamento</button>
        <button type="button" onClick={() => setPanel(panel === 'copiar' ? null : 'copiar')} className={button}>Copiar ano anterior</button>
        <button type="button" onClick={() => setPanel(panel === 'encerrar' ? null : 'encerrar')} className={button}>Encerrar bimestre</button>
      </div>}
    </div>
    {panel === 'criar' && <CreateForm onDone={done} defaultYear={currentYear + 1} />}
    {panel === 'copiar' && <CopyForm onDone={done} defaultYear={currentYear + 1} />}
    {panel === 'encerrar' && <CloseForm onDone={done} defaultYear={currentYear} />}
    {message && <p role="status" className="rounded border border-border bg-surface p-3 text-sm text-content-secondary">{message}</p>}
    {error ? <p className="rounded bg-status-warning-surface p-3 text-sm text-status-warning-content">{error}</p>
      : !plans ? <p className="text-sm text-content-secondary">Carregando planejamentos…</p>
      : !plans.length ? <p className="rounded border border-border bg-surface p-4 text-sm text-content-secondary">{isManager ? 'Nenhum planejamento neste recorte. Crie do zero, copie o ano anterior ou importe da planilha.' : 'Nenhum planejamento atribuído a você neste recorte.'}</p>
      : <div className="overflow-x-auto rounded border border-border bg-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">Planejamentos pedagógicos</caption>
          <thead><tr className="border-b border-border text-left text-xs text-content-secondary"><th scope="col" className="px-3 py-2">Ano</th><th scope="col" className="px-3 py-2">Disciplina</th><th scope="col" className="px-3 py-2">Série</th><th scope="col" className="px-3 py-2">Bim.</th><th scope="col" className="px-3 py-2">Versão oficial</th><th scope="col" className="px-3 py-2">Em trabalho</th><th scope="col" className="px-3 py-2">Responsáveis</th><th scope="col" className="px-3 py-2"><span className="sr-only">Abrir</span></th></tr></thead>
          <tbody>{plans.map((plan) => <tr key={plan.id} className="border-b border-border last:border-0">
            <td className="px-3 py-2 tabular-nums">{plan.academicYear}</td>
            <td className="px-3 py-2 font-medium text-content-primary">{plan.subject}</td>
            <td className="px-3 py-2">{plan.gradeYear}º ano</td>
            <td className="px-3 py-2">{plan.bimester}º</td>
            <td className="px-3 py-2">{plan.official ? <StatusBadge status={plan.official.status} versionNumber={plan.official.versionNumber} /> : <span className="text-xs text-content-muted">nenhuma aprovada</span>}</td>
            <td className="px-3 py-2">{plan.open ? <StatusBadge status={plan.open.status} versionNumber={plan.open.versionNumber} /> : <span className="text-xs text-content-muted">—</span>}</td>
            <td className="px-3 py-2 text-xs text-content-secondary">{plan.assignments.map((person) => person.name).join(', ') || '—'}</td>
            <td className="px-3 py-2 text-right"><Link href={`/planejamento/${plan.id}`} className="font-medium text-harmonia-green hover:underline">Abrir</Link></td>
          </tr>)}</tbody>
        </table>
      </div>}
  </div>
}
