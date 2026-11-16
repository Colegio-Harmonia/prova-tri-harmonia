'use client'

// Pré-requisitos curriculares ("A é base para B"). A IA sugere escolhendo só
// entre habilidades já planejadas antes; a coordenação/direção aprova ou
// rejeita. Só os aprovados entram na Teia do relatório do aluno.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

type Strength = 'essencial' | 'importante' | 'apoio'
type Status = 'sugerida' | 'aprovada' | 'rejeitada'
type Option = { segment: string; gradeYear: number; subject: string }
type Prerequisite = {
  id: number
  subject: string
  prerequisiteCode: string; prerequisiteSegment: string; prerequisiteGradeYear: number
  skillCode: string; skillSegment: string; skillGradeYear: number
  status: Status; source: 'ia' | 'coordenacao'; strength: Strength; rationale: string
  reviewNote: string | null; reviewerName: string | null
}

const STRENGTH_LABEL: Record<Strength, string> = { essencial: 'Essencial', importante: 'Importante', apoio: 'Apoio' }
const STATUS_LABEL: Record<Status, string> = { sugerida: 'Sugerida', aprovada: 'Aprovada', rejeitada: 'Rejeitada' }
const STATUS_CLASS: Record<Status, string> = {
  sugerida: 'bg-status-warning-surface text-status-warning-content',
  aprovada: 'bg-status-success-surface text-status-success-content',
  rejeitada: 'bg-surface-subtle text-content-secondary',
}
const grade = (segment: string, gradeYear: number) => (segment === 'ensino-medio' ? `${gradeYear}ª série EM` : `${gradeYear}º ano`)
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
const optionKey = (option: Option) => `${option.segment}|${option.gradeYear}|${option.subject}`

export default function PrerequisitesPanel({ isManager }: { isManager: boolean }) {
  const [options, setOptions] = useState<Option[]>([])
  const [selected, setSelected] = useState<string>('')
  const [status, setStatus] = useState<Status | 'todas'>('sugerida')
  const [rows, setRows] = useState<Prerequisite[] | null>(null)
  const [descriptions, setDescriptions] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<Record<number, Strength>>({})
  const [form, setForm] = useState({ prerequisiteCode: '', skillCode: '', strength: 'importante' as Strength, rationale: '' })

  const current = useMemo(() => options.find((option) => optionKey(option) === selected) ?? null, [options, selected])

  // Depende só de valores simples (texto da seleção e situação): depender do
  // objeto `current` recriava a função a cada carga e entrava em ciclo.
  const load = useCallback(async () => {
    const params = new URLSearchParams()
    const [segment, gradeYear, subject] = selected ? selected.split('|') : []
    if (selected) { params.set('subject', subject); params.set('segment', segment); params.set('gradeYear', gradeYear) }
    if (status !== 'todas') params.set('status', status)
    const response = await fetch(`/api/curriculum/prerequisites?${params}`)
    const body = await response.json().catch(() => ({}))
    if (!response.ok) { setError(body.error ?? 'Não foi possível carregar os pré-requisitos.'); return }
    setOptions(body.options ?? [])
    setRows(body.prerequisites ?? [])
    setDescriptions(body.descriptions ?? {})
    if (!selected && body.options?.length) setSelected(optionKey(body.options[0]))
  }, [status, selected])

  useEffect(() => { load() }, [load])

  async function suggest() {
    if (!current) return
    setSuggesting(true); setMessage(null); setError(null)
    const response = await fetch('/api/curriculum/prerequisites/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(current) })
    const body = await response.json().catch(() => ({}))
    setSuggesting(false)
    if (!response.ok) { setError(body.error ?? 'Não foi possível obter as sugestões.'); return }
    setMessage(body.targets === 0
      ? (body.alreadyMapped ? `Todas as habilidades desta série já têm pré-requisitos registrados (${body.alreadyMapped}). Nada foi enviado à IA.` : 'Não há habilidades planejadas antes desta série para servir de base. Nada foi enviado à IA.')
      : `${plural(body.created, 'sugestão nova', 'sugestões novas')} para ${plural(body.targets, 'habilidade', 'habilidades')}.${body.discarded ? ` ${plural(body.discarded, 'resposta da IA foi descartada', 'respostas da IA foram descartadas')} por citar código fora da lista ou sem justificativa.` : ''}${body.alreadyMapped ? ` ${plural(body.alreadyMapped, 'habilidade já tinha registro e foi pulada', 'habilidades já tinham registro e foram puladas')}.` : ''}`)
    setStatus('sugerida')
    load()
  }

  async function review(row: Prerequisite, next: 'aprovada' | 'rejeitada', strength?: Strength) {
    setBusyId(row.id); setError(null)
    const response = await fetch(`/api/curriculum/prerequisites/${row.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: next, strength: strength ?? row.strength }) })
    const body = await response.json().catch(() => ({}))
    setBusyId(null)
    if (!response.ok) { setError(body.error ?? 'Não foi possível salvar a revisão.'); return }
    setRows((list) => (list ?? []).map((item) => (item.id === row.id ? { ...item, ...body.prerequisite } : item)).filter((item) => status === 'todas' || item.status === status))
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!current) return
    setError(null); setMessage(null)
    const response = await fetch('/api/curriculum/prerequisites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject: current.subject, ...form }) })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) { setError(body.error ?? 'Não foi possível cadastrar.'); return }
    setForm({ prerequisiteCode: '', skillCode: '', strength: 'importante', rationale: '' })
    setMessage(`Cadastrado e aprovado: ${body.prerequisite.prerequisiteCode} é base para ${body.prerequisite.skillCode}.`)
    load()
  }

  const grouped = useMemo(() => {
    const map = new Map<string, Prerequisite[]>()
    for (const row of rows ?? []) map.set(row.skillCode, [...(map.get(row.skillCode) ?? []), row])
    return [...map.entries()]
  }, [rows])
  const pendingCount = (rows ?? []).filter((row) => row.status === 'sugerida').length

  const describe = (code: string) => descriptions[code] ? <span className="block text-xs text-content-secondary">{descriptions[code]}</span> : null

  return <div className="space-y-4">
    <section className="rounded border border-border bg-surface p-5">
      <h2 className="font-semibold text-content-primary">Pré-requisitos entre habilidades</h2>
      <p className="mt-1 max-w-3xl text-sm text-content-secondary">Indica quais habilidades são base para outras. A IA só sugere entre habilidades planejadas antes (até duas séries atrás ou bimestre anterior da mesma série). Nada entra na Teia do aluno sem aprovação da coordenação ou da direção.</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm text-content-secondary">Série e disciplina
          <select value={selected} onChange={(event) => setSelected(event.target.value)} className="mt-1 block min-h-10 rounded border border-border bg-surface px-2 text-sm text-content-primary">
            {options.map((option) => <option key={optionKey(option)} value={optionKey(option)}>{option.subject} · {grade(option.segment, option.gradeYear)}</option>)}
          </select>
        </label>
        <label className="text-sm text-content-secondary">Situação
          <select value={status} onChange={(event) => setStatus(event.target.value as Status | 'todas')} className="mt-1 block min-h-10 rounded border border-border bg-surface px-2 text-sm text-content-primary">
            <option value="sugerida">Aguardando revisão</option><option value="aprovada">Aprovados</option><option value="rejeitada">Rejeitados</option><option value="todas">Todos</option>
          </select>
        </label>
        {isManager && <button type="button" onClick={suggest} disabled={!current || suggesting} className="min-h-10 rounded bg-action-primary px-4 text-sm font-semibold text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-60">
          {suggesting ? 'Consultando a IA… (pode levar 1 a 2 minutos)' : 'Sugerir com IA para esta série'}</button>}
      </div>
      {!options.length && rows !== null && <p className="mt-3 text-sm text-content-secondary">Ainda não há planejamento cadastrado para montar o mapa de pré-requisitos.</p>}
      {message && <p role="status" className="mt-3 rounded bg-status-info-surface p-3 text-sm text-status-info-content">{message}</p>}
      {error && <p role="alert" className="mt-3 rounded bg-status-danger-surface p-3 text-sm text-status-danger-content">{error}</p>}
    </section>

    <section className="rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-content-primary">{current ? `${current.subject} · ${grade(current.segment, current.gradeYear)}` : 'Pré-requisitos'}</h3>
        {rows && <p className="text-xs text-content-muted">{rows.length} registros{status === 'sugerida' || status === 'todas' ? ` · ${pendingCount} aguardando revisão` : ''}</p>}
      </div>
      {rows === null ? <p className="mt-3 text-sm text-content-secondary">Carregando…</p>
        : !grouped.length ? <p className="mt-3 text-sm text-content-secondary">{status === 'sugerida' ? 'Nada aguardando revisão nesta série.' : 'Nenhum registro nesta série com esse filtro.'}{isManager && status === 'sugerida' ? ' Use "Sugerir com IA" para começar.' : ''}</p>
        : <ul className="mt-3 space-y-4">{grouped.map(([skillCode, items]) => <li key={skillCode} className="rounded border border-border p-4">
          <p className="text-sm font-semibold text-content-primary">{skillCode} <span className="font-normal text-content-secondary">· {grade(items[0].skillSegment, items[0].skillGradeYear)} · depende de</span></p>
          {describe(skillCode)}
          <ul className="mt-3 divide-y divide-border">{items.map((row) => <li key={row.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="min-w-0 text-sm">
              <p className="text-content-primary"><span className="font-medium">{row.prerequisiteCode}</span> <span className="text-content-secondary">· {grade(row.prerequisiteSegment, row.prerequisiteGradeYear)}</span>
                <span className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                <span className="ml-2 text-xs text-content-muted">{row.source === 'ia' ? 'sugerido pela IA' : 'cadastrado pela coordenação'}{row.reviewerName ? ` · revisado por ${row.reviewerName}` : ''}</span></p>
              {describe(row.prerequisiteCode)}
              <p className="mt-1 text-content-secondary">{row.rationale}</p>
              {row.reviewNote && <p className="mt-1 text-xs text-content-muted">Nota da revisão: {row.reviewNote}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isManager ? <>
                {/* Aprovado: trocar a força salva na hora. Sugerido/rejeitado: só vale ao clicar em Aprovar. */}
                <select aria-label={`Força de ${row.prerequisiteCode} para ${row.skillCode}`} value={drafts[row.id] ?? row.strength} disabled={busyId === row.id}
                  onChange={(event) => { const value = event.target.value as Strength; if (row.status === 'aprovada') review(row, 'aprovada', value); else setDrafts((all) => ({ ...all, [row.id]: value })) }}
                  className="min-h-9 rounded border border-border bg-surface px-2 text-xs text-content-primary">
                  {(Object.keys(STRENGTH_LABEL) as Strength[]).map((value) => <option key={value} value={value}>{STRENGTH_LABEL[value]}</option>)}
                </select>
                {row.status !== 'aprovada' && <button type="button" disabled={busyId === row.id} onClick={() => review(row, 'aprovada', drafts[row.id])} className="min-h-9 rounded border border-action-primary px-3 text-xs font-semibold text-action-primary hover:bg-action-primary/10 disabled:opacity-60">Aprovar</button>}
                {row.status !== 'rejeitada' && <button type="button" disabled={busyId === row.id} onClick={() => review(row, 'rejeitada')} className="min-h-9 rounded border border-border px-3 text-xs font-medium text-content-secondary hover:bg-surface-subtle disabled:opacity-60">Rejeitar</button>}
              </> : <span className="text-xs text-content-secondary">{STRENGTH_LABEL[row.strength]}</span>}
            </div>
          </li>)}</ul>
        </li>)}</ul>}
    </section>

    {isManager && current && <form onSubmit={create} className="rounded border border-border bg-surface p-5">
      <h3 className="font-semibold text-content-primary">Cadastrar pré-requisito</h3>
      <p className="mt-1 text-sm text-content-secondary">Para registrar um que a IA não sugeriu. Os dois códigos precisam estar no planejamento de {current.subject}; o cadastro já nasce aprovado.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-content-secondary">Habilidade-base<input required value={form.prerequisiteCode} onChange={(event) => setForm({ ...form, prerequisiteCode: event.target.value })} placeholder="EF06MA07" className="mt-1 block min-h-10 w-full rounded border border-border bg-surface px-2 text-sm uppercase text-content-primary" /></label>
        <label className="text-sm text-content-secondary">Depende dela<input required value={form.skillCode} onChange={(event) => setForm({ ...form, skillCode: event.target.value })} placeholder="EF07MA10" className="mt-1 block min-h-10 w-full rounded border border-border bg-surface px-2 text-sm uppercase text-content-primary" /></label>
        <label className="text-sm text-content-secondary">Força<select value={form.strength} onChange={(event) => setForm({ ...form, strength: event.target.value as Strength })} className="mt-1 block min-h-10 w-full rounded border border-border bg-surface px-2 text-sm text-content-primary">
          {(Object.keys(STRENGTH_LABEL) as Strength[]).map((value) => <option key={value} value={value}>{STRENGTH_LABEL[value]}</option>)}</select></label>
      </div>
      <label className="mt-3 block text-sm text-content-secondary">Justificativa<textarea required minLength={10} maxLength={400} value={form.rationale} onChange={(event) => setForm({ ...form, rationale: event.target.value })} rows={2} className="mt-1 block w-full rounded border border-border bg-surface p-2 text-sm text-content-primary" /></label>
      <button type="submit" className="mt-3 min-h-10 rounded bg-action-primary px-4 text-sm font-semibold text-action-primary-foreground hover:bg-action-primary-hover">Cadastrar e aprovar</button>
    </form>}
  </div>
}
