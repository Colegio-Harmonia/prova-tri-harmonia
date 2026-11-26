'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import type { RecoveryContentPlanItem, RecoveryRoundStatus, RecoverySkill } from '@/db/schema'
import { buildRecoveryContentPlan, periodLabel } from '@/lib/recovery/recoveryPlan'
import { ROUND_STATUS_LABELS, ROUND_STATUS_TONES } from '@/lib/recovery/labels'
import RecoveryComposition, { type Composition } from './RecoveryComposition'
import ChapterMatrix, { type Chapter } from './ChapterMatrix'

type Round = Composition & { id: number; classroomCourseId: string; classLabel: string; subject: string; gradeYear: number; bimester: number | null; semester: number | null; status: RecoveryRoundStatus }
type Student = {
  id: number; classroomStudentId: string; studentName: string; status: 'planejado' | 'gerando' | 'gerada' | 'sem_habilidades' | 'removido'
  weakSkills: RecoverySkill[]; insufficientSkills: RecoverySkill[]; contentPlan: RecoveryContentPlanItem[]
  examId: number | null; generation: 'na_fila' | 'erro' | null; jobError: string | null; examQuestionCount: number | null
}
type RosterEntry = { classroomStudentId: string; name: string; email: string | null; weakSkills: RecoverySkill[]; insufficientSkills: RecoverySkill[] }
type Detail = { round: Round; students: Student[]; chapters: Chapter[] | null; chaptersError: string | null; roster: RosterEntry[] | null; rosterError: string | null }

const JSON_HEADERS = { 'Content-Type': 'application/json' }

function SkillChips({ skills }: { skills: RecoverySkill[] }) {
  if (!skills.length) return <span className="text-xs text-content-muted">Nenhuma habilidade abaixo de 60%</span>
  return <><div className="flex flex-wrap gap-1.5">{skills.map((skill) => <span key={skill.code} title={[skill.description, skill.smallSample ? `Amostra pequena: ${skill.itemCount} questão(ões) avaliada(s)` : null].filter(Boolean).join(' · ') || undefined} className="rounded bg-status-warning-surface px-2 py-0.5 text-xs font-medium text-status-warning-content">{skill.code} · {skill.masteryPercent?.toFixed(0) ?? '—'}%{skill.smallSample && <span className="font-normal"> · {skill.itemCount}q*</span>}</span>)}</div>
    {skills.some((skill) => skill.smallSample) && <p className="mt-1 text-xs text-content-muted">* Amostra pequena (menos de 3 questões avaliadas). Entrou porque o aluno não tem habilidade fraca com amostra suficiente; confira a matriz.</p>}</>
}

function studentState(student: Student) {
  if (student.status === 'sem_habilidades') return { label: 'Sem habilidade abaixo de 60% nos capítulos do período', tone: 'text-content-muted' }
  if (student.status === 'planejado') return { label: 'Matriz pronta · confira antes de gerar', tone: 'text-status-warning-content' }
  if (student.status === 'gerada') return { label: `Prova pronta${student.examQuestionCount ? ` · ${student.examQuestionCount} questões` : ''}`, tone: 'text-status-success-content' }
  if (student.generation === 'erro') return { label: 'Erro na geração', tone: 'text-status-danger-content' }
  return { label: 'Na fila de geração…', tone: 'text-status-info-content' }
}

export default function RoundDetail({ roundId, isSuperuser }: { roundId: number; isSuperuser: boolean }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [composition, setComposition] = useState<Composition | null>(null)
  const [plans, setPlans] = useState<Record<number, RecoveryContentPlanItem[]>>({})

  const load = useCallback(async () => {
    const response = await fetch(`/api/recovery/${roundId}`)
    const body = await response.json().catch(() => ({}))
    if (!response.ok) { setError(body.message ?? body.error ?? 'Não foi possível carregar o lote.'); return }
    setDetail(body)
    setComposition({ questionSource: body.round.questionSource, questionCount: body.round.questionCount, objectivePercentage: body.round.objectivePercentage })
    setPlans(Object.fromEntries((body.students as Student[]).map((student) => [student.id, student.contentPlan])))
  }, [roundId])

  useEffect(() => { void load() }, [load])
  const generating = detail?.students.some((student) => student.generation === 'na_fila') ?? false
  useEffect(() => {
    if (!generating) return
    const timer = setInterval(() => { void load() }, 8000)
    return () => clearInterval(timer)
  }, [generating, load])

  const flaggedIds = useMemo(() => new Set(detail?.students.filter((student) => student.status !== 'sem_habilidades').map((student) => student.classroomStudentId)), [detail])

  async function call(url: string, init: RequestInit, success: string | ((body: Record<string, number>) => string)) {
    setBusy(true); setMessage(null)
    try {
      const response = await fetch(url, init)
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage([body.message ?? body.error ?? 'Não foi possível concluir.', ...(body.failures ?? [])].join(' · '))
        return false
      }
      await load()
      setMessage(typeof success === 'function' ? success(body) : success)
      return true
    } finally { setBusy(false) }
  }

  if (error) return <div className="rounded border border-status-danger-border bg-status-danger-surface p-4 text-sm text-status-danger-content"><p>{error}</p><Link href="/recuperacao" className="mt-2 inline-block underline">Voltar</Link></div>
  if (!detail || !composition) return <p className="text-sm text-content-secondary">Carregando lote…</p>

  const { round, students, chapters, chaptersError, roster, rosterError } = detail
  const editable = round.status === 'aberto'
  const compositionDirty = composition.questionSource !== round.questionSource || composition.questionCount !== round.questionCount || composition.objectivePercentage !== round.objectivePercentage
  const planned = students.filter((student) => student.status === 'planejado')
  const others = students.filter((student) => student.status !== 'planejado')
  const readyCount = students.filter((student) => student.status === 'gerada').length
  const blocking = students.filter((student) => student.status === 'gerando' || student.status === 'planejado').length
  const sum = (plan: RecoveryContentPlanItem[]) => plan.reduce((total, item) => total + item.questionCount, 0)
  const unsavedPlans = planned.filter((student) => JSON.stringify(plans[student.id] ?? []) !== JSON.stringify(student.contentPlan))
  const invalidPlans = planned.filter((student) => sum(plans[student.id] ?? []) !== round.questionCount)

  async function savePlan(student: Student) {
    await call(`/api/recovery/${roundId}/students/${student.id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ contentPlan: plans[student.id] ?? [] }) }, `Matriz de ${student.studentName} salva.`)
  }

  return <div className="space-y-6 pb-10">
    <div>
      <Link href="/recuperacao" className="text-sm text-content-secondary underline">← Recuperação</Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-content-primary">Recuperação · {round.subject}</h1>
          <p className="mt-1 text-sm text-content-secondary">{round.classLabel} · {round.gradeYear}º ano · {periodLabel(round.bimester, round.semester)} · {round.questionCount} questões por aluno</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${ROUND_STATUS_TONES[round.status]}`}>{ROUND_STATUS_LABELS[round.status]}</span>
      </div>
    </div>

    {message && <p role="status" className="rounded border border-border bg-surface-subtle p-3 text-sm text-content-primary">{message}</p>}
    {chaptersError && <p className="rounded border border-status-warning-border bg-status-warning-surface p-3 text-sm text-status-warning-content">{chaptersError}</p>}

    <RecoveryComposition value={composition} onChange={setComposition} disabled={!editable || busy} dirty={compositionDirty} saving={busy}
      onSave={() => void call(`/api/recovery/${roundId}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(composition) }, (body) => `Composição salva.${body.replanned ? ` Matriz refeita para ${body.replanned} aluno(s).` : ''}`)} />

    {editable && <section className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-5 py-4">
        <h2 className="font-semibold text-content-primary">1. Marque quem ficou de recuperação</h2>
        <p className="mt-1 text-sm text-content-secondary">Ao lado de cada aluno, as habilidades abaixo de 60% em {periodLabel(round.bimester, round.semester).toLowerCase()}, lidas das correções revisadas. Habilidade com menos de 3 questões avaliadas aparece como “amostra pequena” e só entra na prova (marcada com *) quando o aluno não tem nenhuma habilidade fraca com amostra suficiente.</p>
      </div>
      {rosterError && <div className="px-5 py-4 text-sm text-status-warning-content"><p>{rosterError}</p><button type="button" onClick={() => signIn('google', { callbackUrl: `/recuperacao/${roundId}` })} className="mt-2 rounded-md bg-action-primary px-3 py-2 font-medium text-action-primary-foreground hover:bg-action-primary-hover">Entrar com Google</button></div>}
      {roster && <>
        <ul className="divide-y divide-border">{roster.map((entry) => {
          const already = flaggedIds.has(entry.classroomStudentId)
          return <li key={entry.classroomStudentId} className="flex items-start gap-3 px-5 py-3">
            <input type="checkbox" aria-label={`Marcar ${entry.name}`} className="mt-1 h-4 w-4" disabled={already || busy} checked={already || selected.has(entry.classroomStudentId)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(entry.classroomStudentId); else next.delete(entry.classroomStudentId); return next })} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-content-primary">{entry.name}{already && <span className="ml-2 text-xs font-normal text-content-muted">já no lote</span>}</p>
              <div className="mt-1"><SkillChips skills={entry.weakSkills} /></div>
              {entry.insufficientSkills.length > 0 && <p className="mt-1 text-xs text-content-muted">Amostra pequena: {entry.insufficientSkills.map((skill) => skill.code).join(', ')}</p>}
            </div>
          </li>
        })}</ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
          <p className="text-xs text-content-muted">{selected.size} selecionado(s). Marcar monta a matriz de cada um; nada é gerado ainda.</p>
          <button type="button" disabled={!selected.size || busy || !chapters} onClick={() => void call(`/api/recovery/${roundId}/students`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ classroomStudentIds: [...selected] }) }, (body) => { setSelected(new Set()); return `${body.planned} matriz(es) montada(s) para conferência${body.withoutSkills ? ` · ${body.withoutSkills} aluno(s) sem habilidade abaixo de 60% no período` : ''}${body.alreadyFlagged ? ` · ${body.alreadyFlagged} já estavam no lote` : ''}.` })} className="rounded-md bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-50">Marcar e montar matriz</button>
        </div>
      </>}
    </section>}

    {editable && planned.length > 0 && chapters && <section className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-5 py-4">
        <h2 className="font-semibold text-content-primary">2. Conferência: matriz da avaliação de cada aluno</h2>
        <p className="mt-1 text-sm text-content-secondary">Sugerida pelas habilidades fracas (mais questões nos capítulos mais distantes de 60%). Ajuste se quiser e salve; depois gere as provas.</p>
      </div>
      <ul className="divide-y divide-border">{planned.map((student) => {
        const plan = plans[student.id] ?? []
        const changed = JSON.stringify(plan) !== JSON.stringify(student.contentPlan)
        return <li key={student.id} className="space-y-3 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="font-medium text-content-primary">{student.studentName}</p><div className="mt-1"><SkillChips skills={student.weakSkills} /></div></div>
            <div className="flex gap-2">
              {changed && <button type="button" disabled={busy || sum(plan) !== round.questionCount} onClick={() => void savePlan(student)} className="rounded-md bg-action-primary px-3 py-1.5 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-50">Salvar matriz</button>}
              <button type="button" disabled={busy} onClick={() => { if (confirm(`Tirar ${student.studentName} do lote?`)) void call(`/api/recovery/${roundId}/students/${student.id}`, { method: 'DELETE' }, 'Aluno removido do lote.') }} className="rounded-md px-3 py-1.5 text-sm font-medium text-status-danger-content hover:bg-status-danger-surface disabled:opacity-50">Remover</button>
            </div>
          </div>
          <ChapterMatrix chapters={chapters} weakCodes={student.weakSkills.map((skill) => skill.code)} plan={plan} total={round.questionCount} disabled={busy}
            onChange={(next) => setPlans((current) => ({ ...current, [student.id]: next }))}
            onReset={() => setPlans((current) => ({ ...current, [student.id]: buildRecoveryContentPlan(chapters, student.weakSkills, round.questionCount).contentPlan }))} />
        </li>
      })}</ul>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
        <p className="text-xs text-content-muted">{unsavedPlans.length ? `${unsavedPlans.length} matriz(es) com alteração não salva.` : invalidPlans.length ? `${invalidPlans.length} matriz(es) não somam ${round.questionCount}.` : `${planned.length} prova(s) prontas para gerar.`}</p>
        <button type="button" disabled={busy || compositionDirty || unsavedPlans.length > 0 || invalidPlans.length > 0} onClick={() => void call(`/api/recovery/${roundId}/actions`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'gerar' }) }, (body) => `${body.queued} prova(s) na fila de geração.`)} className="rounded-md bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-50">Gerar {planned.length} prova(s)</button>
      </div>
    </section>}

    <section className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-5 py-4">
        <h2 className="font-semibold text-content-primary">{editable ? '3. Revise as provas geradas' : 'Provas do lote'}</h2>
        <p className="mt-1 text-sm text-content-secondary">Uma prova por aluno, gerada pelo fluxo da prova formal a partir do Planejamento do período.{generating ? ' Atualizando a cada poucos segundos enquanto houver prova na fila.' : ''}</p>
      </div>
      {others.length === 0 ? <p className="px-5 py-6 text-sm text-content-secondary">Nenhuma prova gerada ainda.</p> : <ul className="divide-y divide-border">{others.map((student) => {
        const state = studentState(student)
        return <li key={student.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-content-primary">{student.studentName}</p>
            <p className={`mt-0.5 text-xs font-medium ${state.tone}`}>{state.label}</p>
            {student.jobError && <p className="mt-1 text-xs text-status-danger-content">{student.jobError}</p>}
            <div className="mt-2"><SkillChips skills={student.weakSkills} /></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {student.examId && <Link href={`/gerar/${student.examId}/revisar`} className="rounded-md border border-harmonia-green px-3 py-1.5 text-sm font-medium text-harmonia-green">Revisar prova</Link>}
            {editable && student.weakSkills.length > 0 && student.generation !== 'na_fila' && <button type="button" disabled={busy} onClick={() => { if (confirm(`Refazer a prova de ${student.studentName}? A atual será arquivada e a matriz volta para a conferência.`)) void call(`/api/recovery/${roundId}/students/${student.id}`, { method: 'POST' }, 'Matriz de volta para a conferência.') }} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-primary hover:bg-surface-subtle disabled:opacity-50">Gerar de novo</button>}
            {editable && <button type="button" disabled={busy} onClick={() => { if (confirm(`Tirar ${student.studentName} do lote?`)) void call(`/api/recovery/${roundId}/students/${student.id}`, { method: 'DELETE' }, 'Aluno removido do lote.') }} className="rounded-md px-3 py-1.5 text-sm font-medium text-status-danger-content hover:bg-status-danger-surface disabled:opacity-50">Remover</button>}
          </div>
        </li>
      })}</ul>}
    </section>

    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-4">
      {round.status === 'aberto' && <>
        <p className="text-sm text-content-secondary">{blocking ? `${blocking} aluno(s) ainda na conferência, na fila ou com erro: gere, refaça ou remova antes de enviar.` : `${readyCount} prova(s) pronta(s). Ao enviar, a coordenação recebe o lote para aprovação.`}</p>
        <button type="button" disabled={busy || blocking > 0 || readyCount === 0} onClick={() => void call(`/api/recovery/${roundId}/actions`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'enviar' }) }, 'Lote enviado para a coordenação.')} className="rounded-md bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-50">4. Enviar para a coordenação</button>
      </>}
      {round.status === 'em_aprovacao' && (isSuperuser ? <>
        <p className="text-sm text-content-secondary">Aprovar gera os documentos (prova e gabarito) de cada aluno no Google Docs e libera o lote na fila de impressão. Pode levar alguns minutos.</p>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => void call(`/api/recovery/${roundId}/actions`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'devolver' }) }, 'Lote devolvido ao professor.')} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-content-primary disabled:opacity-50">Devolver ao professor</button>
          <button type="button" disabled={busy} onClick={() => void call(`/api/recovery/${roundId}/actions`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ action: 'aprovar' }) }, 'Lote aprovado. Já está na fila de impressão.')} className="rounded-md bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-50">{busy ? 'Gerando documentos…' : 'Aprovar lote'}</button>
        </div>
      </> : <p className="text-sm text-content-secondary">Lote enviado. Aguardando a coordenação aprovar.</p>)}
      {(round.status === 'aprovado' || round.status === 'impresso') && <>
        <p className="text-sm text-content-secondary">PDF único da sala, em ordem alfabética, com o nome de cada aluno no topo das páginas e o cartão-resposta com QR depois de cada prova.</p>
        <div className="flex gap-2">
          <a href={`/api/recovery/${roundId}/pdf?doc=prova`} className="rounded-md bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover">Baixar provas (PDF)</a>
          <a href={`/api/recovery/${roundId}/pdf?doc=gabarito`} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-content-primary">Gabaritos (PDF)</a>
        </div>
      </>}
    </section>
  </div>
}
