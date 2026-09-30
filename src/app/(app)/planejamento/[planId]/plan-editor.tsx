'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { PLANNING_STATUS_LABELS, type PlanningStatus } from '@/lib/curriculum/planningPolicy'
import { StatusBadge } from '../planning-list'

type Skill = { code: string; description: string | null; targetMasteryPercent: number }
type Unit = { title: string; content: string | null; objectives: string | null; skills: Skill[] }
type Detail = {
  plan: { id: number; academicYear: number; segment: string; gradeYear: number; subject: string; bimester: number }
  versions: Array<{ id: number; versionNumber: number; status: PlanningStatus; source: string; sourceReference: string | null; updatedAt: string }>
  selectedVersionId: number | null
  officialVersionId: number | null
  units: Unit[]
  assignments: Array<{ userId: number; name: string; email: string; responsibility: 'responsavel' | 'colaborador' }>
  history: Array<{ id: number; versionId: number; fromStatus: PlanningStatus | null; toStatus: PlanningStatus; note: string | null; createdAt: string; changedBy: string }>
  permissions: { edit: boolean; manage: boolean; startNewVersion: { ok: boolean; reason?: string }; transitions: PlanningStatus[] }
}

const input = 'w-full rounded border border-border bg-canvas px-2 py-1.5 text-sm'
const button = 'rounded border border-border px-3 py-1.5 text-sm font-medium text-content-primary hover:bg-surface-subtle disabled:opacity-50'
const primary = 'rounded bg-harmonia-green px-3 py-1.5 text-sm font-semibold text-action-primary-foreground disabled:opacity-50'
const SOURCE_LABEL: Record<string, string> = { interno: 'criado na Prova TRI', planilha: 'importado da planilha', copia: 'copiado de outro ano' }

function transitionLabel(from: PlanningStatus, to: PlanningStatus) {
  if (to === 'em_revisao') return 'Enviar para revisão'
  if (to === 'aprovado') return 'Aprovar'
  if (to === 'encerrado') return 'Encerrar bimestre'
  if (from === 'em_revisao' && to === 'rascunho') return 'Devolver para ajustes'
  return PLANNING_STATUS_LABELS[to]
}

function UnitEditor({ unit, index, total, onChange, onMove, onRemove }: { unit: Unit; index: number; total: number; onChange: (unit: Unit) => void; onMove: (delta: number) => void; onRemove: () => void }) {
  const setSkill = (skillIndex: number, patch: Partial<Skill>) => onChange({ ...unit, skills: unit.skills.map((skill, i) => i === skillIndex ? { ...skill, ...patch } : skill) })
  return <fieldset className="rounded border border-border p-3">
    <legend className="px-1 text-xs font-semibold text-content-secondary">Unidade {index + 1}</legend>
    <div className="flex flex-wrap gap-2">
      <input aria-label={`Título da unidade ${index + 1}`} placeholder="Título da unidade / capítulo" value={unit.title} onChange={(e) => onChange({ ...unit, title: e.target.value })} className={`${input} flex-1 font-medium`} />
      <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className={button} aria-label="Mover unidade para cima">↑</button>
      <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} className={button} aria-label="Mover unidade para baixo">↓</button>
      <button type="button" onClick={onRemove} className={button}>Remover</button>
    </div>
    <div className="mt-2 grid gap-2 md:grid-cols-2">
      <label className="text-xs text-content-secondary">Conteúdos<textarea rows={3} value={unit.content ?? ''} onChange={(e) => onChange({ ...unit, content: e.target.value })} className={`${input} mt-1`} /></label>
      <label className="text-xs text-content-secondary">Objetivos (um por linha)<textarea rows={3} value={unit.objectives ?? ''} onChange={(e) => onChange({ ...unit, objectives: e.target.value })} className={`${input} mt-1`} /></label>
    </div>
    <p className="mt-3 text-xs font-semibold text-content-secondary">Habilidades BNCC</p>
    <div className="mt-1 space-y-1.5">{unit.skills.map((skill, skillIndex) => <div key={skillIndex} className="flex flex-wrap items-start gap-2">
      <input aria-label="Código BNCC" placeholder="EF05MA03" value={skill.code} onChange={(e) => setSkill(skillIndex, { code: e.target.value.toUpperCase() })} className={`${input} w-32 font-mono`} />
      <input aria-label="Descrição da habilidade" placeholder="Descrição (em branco: texto oficial da BNCC)" value={skill.description ?? ''} onChange={(e) => setSkill(skillIndex, { description: e.target.value })} className={`${input} min-w-48 flex-1`} />
      <label className="flex items-center gap-1 text-xs text-content-secondary">Meta<input aria-label="Meta de domínio (%)" type="number" min={0} max={100} value={skill.targetMasteryPercent} onChange={(e) => setSkill(skillIndex, { targetMasteryPercent: Number(e.target.value) })} className={`${input} w-20`} />%</label>
      <button type="button" onClick={() => onChange({ ...unit, skills: unit.skills.filter((_, i) => i !== skillIndex) })} className={button} aria-label={`Remover ${skill.code || 'habilidade'}`}>×</button>
    </div>)}</div>
    <button type="button" onClick={() => onChange({ ...unit, skills: [...unit.skills, { code: '', description: null, targetMasteryPercent: 100 }] })} className={`${button} mt-2`}>+ Habilidade</button>
  </fieldset>
}

function ReadOnlyUnits({ units }: { units: Unit[] }) {
  if (!units.length) return <p className="text-sm text-content-secondary">Esta versão ainda não tem unidades.</p>
  return <ol className="space-y-3">{units.map((unit, index) => <li key={index} className="rounded border border-border p-3">
    <p className="font-medium text-content-primary">{index + 1}. {unit.title}</p>
    {unit.content && <p className="mt-1 whitespace-pre-line text-sm text-content-secondary"><span className="font-semibold">Conteúdos:</span> {unit.content}</p>}
    {unit.objectives && <p className="mt-1 whitespace-pre-line text-sm text-content-secondary"><span className="font-semibold">Objetivos:</span> {unit.objectives}</p>}
    {unit.skills.length > 0 && <ul className="mt-2 space-y-1 text-sm">{unit.skills.map((skill) => <li key={skill.code}><span className="font-mono font-semibold">{skill.code}</span> <span className="text-content-secondary">{skill.description ?? 'Descrição não informada'}</span>{skill.targetMasteryPercent !== 100 && <span className="text-xs text-content-muted"> · meta {skill.targetMasteryPercent}%</span>}</li>)}</ul>}
  </li>)}</ol>
}

function Assignments({ detail, onChanged, setMessage }: { detail: Detail; onChanged: () => void; setMessage: (text: string) => void }) {
  const [staff, setStaff] = useState<Array<{ id: number; name: string; role: string }>>([])
  const [userId, setUserId] = useState('')
  const [responsibility, setResponsibility] = useState<'responsavel' | 'colaborador'>('responsavel')
  useEffect(() => { if (detail.permissions.manage) void fetch('/api/curriculum/plans/staff').then((r) => r.json()).then((body) => setStaff(body.staff ?? [])) }, [detail.permissions.manage])
  async function save(targetUserId: number, value: 'responsavel' | 'colaborador' | null) {
    const response = await fetch(`/api/curriculum/plans/${detail.plan.id}/assignments`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: targetUserId, responsibility: value }) })
    const body = await response.json()
    if (!response.ok) setMessage(body.error ?? 'Não foi possível atualizar os responsáveis.')
    setUserId(''); onChanged()
  }
  return <section className="rounded border border-border bg-surface p-4">
    <h2 className="font-semibold text-content-primary">Responsáveis</h2>
    <p className="mt-1 text-xs text-content-secondary">Professores atribuídos veem este planejamento, editam rascunhos e enviam para revisão.</p>
    {detail.assignments.length ? <ul className="mt-2 space-y-1 text-sm">{detail.assignments.map((person) => <li key={person.userId} className="flex items-center justify-between gap-2"><span>{person.name} <span className="text-xs text-content-muted">({person.responsibility === 'responsavel' ? 'responsável' : 'colaborador'})</span></span>{detail.permissions.manage && <button type="button" onClick={() => save(person.userId, null)} className="text-xs text-content-secondary underline">remover</button>}</li>)}</ul> : <p className="mt-2 text-sm text-content-muted">Nenhum professor atribuído.</p>}
    {detail.permissions.manage && <div className="mt-3 flex flex-wrap gap-2">
      <select aria-label="Professor" value={userId} onChange={(e) => setUserId(e.target.value)} className="min-w-0 flex-1 rounded border border-border bg-canvas px-2 py-1.5 text-sm"><option value="">Selecionar pessoa…</option>{staff.filter((person) => !detail.assignments.some((a) => a.userId === person.id)).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
      <select aria-label="Papel" value={responsibility} onChange={(e) => setResponsibility(e.target.value as 'responsavel' | 'colaborador')} className="rounded border border-border bg-canvas px-2 py-1.5 text-sm"><option value="responsavel">Responsável</option><option value="colaborador">Colaborador</option></select>
      <button type="button" disabled={!userId} onClick={() => save(Number(userId), responsibility)} className={button}>Atribuir</button>
    </div>}
  </section>
}

export default function PlanEditor({ planId }: { planId: number }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [versionId, setVersionId] = useState<number | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (targetVersion?: number | null) => {
    const response = await fetch(`/api/curriculum/plans/${planId}${targetVersion ? `?versionId=${targetVersion}` : ''}`)
    const body = await response.json()
    if (!response.ok) { setError(body.error ?? 'Não foi possível carregar.'); return }
    setDetail(body); setVersionId(body.selectedVersionId); setUnits(body.units); setDirty(false); setErrors([])
  }, [planId])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (error) return <p className="rounded bg-status-warning-surface p-3 text-sm text-status-warning-content">{error}</p>
  if (!detail) return <p className="text-sm text-content-secondary">Carregando planejamento…</p>

  const version = detail.versions.find((item) => item.id === versionId) ?? null
  const updateUnits = (next: Unit[]) => { setUnits(next); setDirty(true) }

  async function save() {
    if (!versionId) return false
    setBusy(true); setErrors([])
    const response = await fetch(`/api/curriculum/plan-versions/${versionId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ units }) })
    const body = await response.json(); setBusy(false)
    if (!response.ok) { setMessage(body.error ?? 'Não foi possível salvar.'); setErrors(body.details ?? []); return false }
    setMessage(`Salvo: ${body.unitCount} unidade(s) e ${body.skillCount} habilidade(s).`)
    await load(versionId)
    return true
  }

  async function transition(to: PlanningStatus) {
    if (!version) return
    if (dirty && !(await save())) return
    const needsNote = version.status === 'em_revisao' && to === 'rascunho'
    const note = needsNote ? window.prompt('O que precisa ser ajustado? (obrigatório)') : to === 'aprovado' || to === 'encerrado' ? window.prompt('Observação (opcional):') ?? undefined : undefined
    if (needsNote && !note?.trim()) return
    if (to === 'encerrado' && !window.confirm('Encerrar trava este planejamento: alterações passarão a exigir nova versão aberta pela coordenação. Continuar?')) return
    setBusy(true)
    const response = await fetch(`/api/curriculum/plan-versions/${version.id}/transition`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, note: note ?? undefined }) })
    const body = await response.json(); setBusy(false)
    setMessage(response.ok ? `Versão ${version.versionNumber}: ${PLANNING_STATUS_LABELS[to].toLowerCase()}.` : body.error ?? 'Não foi possível mudar a situação.')
    await load(version.id)
  }

  async function newVersion() {
    const closed = detail!.versions.find((item) => item.id === detail!.officialVersionId)?.status === 'encerrado'
    const note = window.prompt(closed ? 'Bimestre encerrado: justifique a alteração (obrigatório).' : 'Motivo da nova versão (opcional):')
    if (note === null || (closed && !note.trim())) return
    setBusy(true)
    const response = await fetch(`/api/curriculum/plans/${planId}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) })
    const body = await response.json(); setBusy(false)
    if (!response.ok) { setMessage(body.error ?? 'Não foi possível abrir nova versão.'); return }
    setMessage(`Versão ${body.versionNumber} aberta em rascunho a partir da versão oficial.`)
    await load(body.versionId)
  }

  const { plan, permissions } = detail
  const history = detail.history.filter((item) => item.versionId === versionId)

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Link href="/planejamento" className="text-sm text-content-secondary underline">← Planejamentos</Link>
      <div className="flex gap-2">
        <a href={`/api/curriculum/plans/${plan.id}/export?versionId=${versionId ?? ''}`} className={button}>Exportar planilha</a>
        <Link href={`/planejamento/${plan.id}/imprimir?versionId=${versionId ?? ''}`} target="_blank" className={button}>Exportar PDF</Link>
      </div>
    </div>
    <header>
      <p className="text-sm font-semibold text-harmonia-green">Planejamento {plan.academicYear} · {plan.bimester}º bimestre</p>
      <h1 className="mt-1 text-2xl font-bold text-content-primary">{plan.subject} · {plan.gradeYear}º ano</h1>
    </header>

    <section className="rounded border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-content-secondary" htmlFor="versao">Versão</label>
        <select id="versao" value={versionId ?? ''} onChange={(e) => { if (dirty && !window.confirm('Descartar alterações não salvas?')) return; void load(Number(e.target.value)) }} className="rounded border border-border bg-canvas px-2 py-1.5 text-sm">
          {[...detail.versions].reverse().map((item) => <option key={item.id} value={item.id}>v{item.versionNumber} · {PLANNING_STATUS_LABELS[item.status]}{item.id === detail.officialVersionId ? ' (oficial)' : ''}</option>)}
        </select>
        {version && <StatusBadge status={version.status} />}
        {version && <span className="text-xs text-content-muted">{SOURCE_LABEL[version.source] ?? version.source}{version.sourceReference ? ` (${version.sourceReference})` : ''}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          {version && permissions.transitions.map((to) => <button key={to} type="button" disabled={busy} onClick={() => transition(to)} className={to === 'aprovado' || to === 'em_revisao' ? primary : button}>{transitionLabel(version.status, to)}</button>)}
          {permissions.startNewVersion.ok && <button type="button" disabled={busy} onClick={newVersion} className={button}>Propor alteração (nova versão)</button>}
        </div>
      </div>
      {version && (version.status === 'aprovado' || version.status === 'encerrado') && <p className="mt-2 text-xs text-content-secondary">{version.status === 'encerrado' ? 'Bimestre encerrado: esta versão está travada. Alterações só por nova versão aberta pela coordenação, com justificativa.' : 'Versão aprovada: não é editada diretamente. Para mudar, proponha uma nova versão; ela passa pela revisão antes de substituir esta.'}</p>}
      {!permissions.startNewVersion.ok && version && (version.status === 'aprovado' || version.status === 'encerrado') && permissions.startNewVersion.reason && <p className="mt-1 text-xs text-content-muted">{permissions.startNewVersion.reason}</p>}
    </section>

    {message && <p role="status" className="rounded border border-border bg-surface p-3 text-sm text-content-secondary">{message}{errors.length > 0 && <ul className="mt-2 list-disc pl-5 text-status-danger-content">{errors.map((item) => <li key={item}>{item}</li>)}</ul>}</p>}

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section className="space-y-3">
        {permissions.edit ? <>
          {units.map((unit, index) => <UnitEditor key={index} unit={unit} index={index} total={units.length}
            onChange={(next) => updateUnits(units.map((item, i) => i === index ? next : item))}
            onMove={(delta) => { const next = [...units]; const [moved] = next.splice(index, 1); next.splice(index + delta, 0, moved); updateUnits(next) }}
            onRemove={() => { if (window.confirm(`Remover a unidade "${unit.title || index + 1}"?`)) updateUnits(units.filter((_, i) => i !== index)) }} />)}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => updateUnits([...units, { title: '', content: null, objectives: null, skills: [] }])} className={button}>+ Unidade</button>
            <button type="button" disabled={busy || !dirty} onClick={save} className={primary}>{busy ? 'Salvando…' : dirty ? 'Salvar rascunho' : 'Salvo'}</button>
          </div>
        </> : <ReadOnlyUnits units={units} />}
      </section>
      <aside className="space-y-4">
        <Assignments detail={detail} onChanged={() => load(versionId)} setMessage={setMessage} />
        <section className="rounded border border-border bg-surface p-4">
          <h2 className="font-semibold text-content-primary">Histórico desta versão</h2>
          {history.length ? <ol className="mt-2 space-y-2 text-sm">{history.map((item) => <li key={item.id}><p><span className="font-medium">{item.fromStatus ? `${PLANNING_STATUS_LABELS[item.fromStatus]} → ` : ''}{PLANNING_STATUS_LABELS[item.toStatus]}</span></p><p className="text-xs text-content-muted">{item.changedBy} · {new Date(item.createdAt).toLocaleString('pt-BR')}</p>{item.note && <p className="text-xs text-content-secondary">“{item.note}”</p>}</li>)}</ol> : <p className="mt-2 text-sm text-content-muted">Sem registros.</p>}
        </section>
      </aside>
    </div>
  </div>
}
