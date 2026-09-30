'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SEGMENT_GRADES, SEGMENT_LABELS, SEGMENT_SUBJECTS } from '@/config/subjects'
import type { Segment } from '@/types/exam'

type BnccSkill = { code: string; description: string | null; chapters: string[] }
type ClassroomCourse = { id: string; name: string; section: string | null }

const ACTIVITY_SEGMENTS: Segment[] = ['anos-iniciais', 'anos-finais', 'ensino-medio']
const fieldClassName = 'mt-1 min-h-10 w-full rounded border border-border bg-surface px-3 py-2 text-sm text-content-primary shadow-soft transition-colors hover:border-border-strong focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/25'
const labelClassName = 'text-sm font-semibold text-content-primary'

function initialGrade(segment: Segment) { return SEGMENT_GRADES[segment][0] }

function distribute(total: number, codes: string[]) {
  if (!codes.length) return {} as Record<string, number>
  const base = Math.floor(total / codes.length)
  const remainder = total % codes.length
  return Object.fromEntries(codes.map((code, index) => [code, base + Number(index < remainder)]))
}

function questionsFromPointer(element: HTMLElement, clientX: number, total: number): number {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || total <= 0) return 0
  return Math.max(0, Math.min(total, Math.round(((clientX - rect.left) / rect.width) * total)))
}

export default function AtividadeForm() {
  const searchParams = useSearchParams()
  const requestedSegment = searchParams.get('segment') as Segment | null
  const initialSegment = requestedSegment && ACTIVITY_SEGMENTS.includes(requestedSegment) ? requestedSegment : 'anos-iniciais'
  const requestedGrade = Number(searchParams.get('gradeYear'))
  const initialGradeYear = SEGMENT_GRADES[initialSegment].includes(requestedGrade) ? requestedGrade : initialGrade(initialSegment)
  const requestedSubject = searchParams.get('subject')
  const initialSubject = requestedSubject && SEGMENT_SUBJECTS[initialSegment].includes(requestedSubject) ? requestedSubject : SEGMENT_SUBJECTS[initialSegment][0]
  const requestedBimester = Number(searchParams.get('bimester'))
  const requestedQuestionCount = Number(searchParams.get('questionCount'))
  const recoverySkill = searchParams.get('skill')?.trim().toUpperCase() ?? ''
  const recoveryStudent = searchParams.get('student')?.trim() ?? ''
  const [segment, setSegment] = useState<Segment>(initialSegment)
  const [gradeYear, setGradeYear] = useState(initialGradeYear)
  const [subject, setSubject] = useState(initialSubject)
  const [academicYear, setAcademicYear] = useState(Number(searchParams.get('academicYear')) || new Date().getFullYear())
  const [bimester, setBimester] = useState<number | ''>(requestedBimester >= 1 && requestedBimester <= 4 ? requestedBimester : '')
  const [classLabel, setClassLabel] = useState(recoveryStudent ? `Recuperação — ${recoveryStudent}` : '')
  const [questionCount, setQuestionCount] = useState(requestedQuestionCount >= 1 && requestedQuestionCount <= 30 ? requestedQuestionCount : 15)
  const [skills, setSkills] = useState<BnccSkill[]>([])
  const [plannedCounts, setPlannedCounts] = useState<Record<string, number>>({})
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillsError, setSkillsError] = useState<string | null>(null)
  const [courses, setCourses] = useState<ClassroomCourse[]>([])
  const [classroomCourseId, setClassroomCourseId] = useState(searchParams.get('classroomCourseId') ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<number | null>(null)
  const draggingSkillRef = useRef<string | null>(null)
  const recoveryAppliedRef = useRef(false)
  const subjectOptions = useMemo(() => SEGMENT_SUBJECTS[segment], [segment])
  const selectedPlan = useMemo(() => skills.map((skill) => ({ code: skill.code, questionCount: plannedCounts[skill.code] ?? 0 })).filter((item) => item.questionCount > 0), [plannedCounts, skills])
  const matrixTotal = selectedPlan.reduce((total, item) => total + item.questionCount, 0)

  useEffect(() => {
    setPlannedCounts({}); setSkills([]); setSkillsError(null); setSkillsLoading(true)
    fetch('/api/curriculum/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segment, gradeYear, subject, ...(bimester ? { bimester } : {}) }) })
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Não foi possível ler o currículo.')
        const map = new Map<string, BnccSkill>()
        for (const unit of data.units ?? []) {
          if (unit.habilidades?.status !== 'mapeado') continue
          for (const skill of unit.habilidades.skills ?? []) {
            const code = String(skill.code).toUpperCase()
            const current: BnccSkill = map.get(code) ?? { code, description: skill.description ?? null, chapters: [] }
            if (!current.description && skill.description) current.description = skill.description
            if (unit.tituloCapitulo && !current.chapters.includes(unit.tituloCapitulo)) current.chapters.push(unit.tituloCapitulo)
            map.set(code, current)
          }
        }
        setSkills([...map.values()].sort((a, b) => a.code.localeCompare(b.code, 'pt-BR')))
      })
      .catch((reason) => setSkillsError(reason instanceof Error ? reason.message : 'Não foi possível ler o currículo.'))
      .finally(() => setSkillsLoading(false))
  }, [segment, gradeYear, subject, bimester])

  useEffect(() => { fetch('/api/classroom/courses').then((res) => (res.ok ? res.json() : { courses: [] })).then((data) => setCourses(data.courses ?? [])).catch(() => setCourses([])) }, [])

  useEffect(() => {
    if (!recoverySkill || recoveryAppliedRef.current || skillsLoading) return
    if (!skills.some((skill) => skill.code === recoverySkill)) {
      if (skills.length) setSkillsError(`A habilidade ${recoverySkill} não está no planejamento deste recorte. Confira o planejamento antes de gerar.`)
      return
    }
    setPlannedCounts({ [recoverySkill]: questionCount })
    recoveryAppliedRef.current = true
  }, [questionCount, recoverySkill, skills, skillsLoading])

  function changeSegment(nextSegment: Segment) { setSegment(nextSegment); setGradeYear(initialGrade(nextSegment)); setSubject(SEGMENT_SUBJECTS[nextSegment][0]) }
  function setPlannedCount(code: string, count: number) { setPlannedCounts((current) => ({ ...current, [code]: Math.max(0, Math.min(questionCount, Math.round(count) || 0)) })) }
  function balanceSelectedSkills() {
    const codes = selectedPlan.map((item) => item.code)
    if (codes.length) setPlannedCounts((current) => ({ ...current, ...distribute(questionCount, codes) }))
  }
  function chooseCourse(courseId: string) {
    setClassroomCourseId(courseId)
    const course = courses.find((item) => item.id === courseId)
    if (course && !classLabel.trim()) setClassLabel([course.name, course.section].filter(Boolean).join(' — '))
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSubmitting(true); setError(null)
    try {
      const response = await fetch('/api/activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segment, gradeYear, subject, academicYear, ...(bimester ? { bimester } : {}), questionCount, bnccCodes: selectedPlan.map((item) => item.code), bnccPlan: selectedPlan, ...(classLabel.trim() ? { classLabel: classLabel.trim() } : {}), ...(classroomCourseId ? { classroomCourseId } : {}) }) })
      const data = await response.json()
      if (!response.ok) {
        const detail = Array.isArray(data.issues) && data.issues.length ? data.issues.map((item: { path?: Array<string | number>; message?: string }) => `${item.path?.join('.') || 'campo'}: ${item.message ?? 'inválido'}`).join('; ') : null
        throw new Error(detail ? `${data.error ?? 'Parâmetros inválidos'} — ${detail}` : data.error ?? 'Erro ao adicionar à fila.')
      }
      setJobId(data.jobId)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Erro ao adicionar à fila.') } finally { setSubmitting(false) }
  }

  if (jobId) return <div className="space-y-4 rounded border border-harmonia-green/30 bg-harmonia-green/5 p-6"><p className="text-sm font-semibold text-action-primary">Atividade adicionada à fila de geração.</p><p className="text-sm text-content-secondary">{subject} · {gradeYear}º ano · {selectedPlan.map((item) => `${item.code} (${item.questionCount})`).join(', ')}.</p><p className="text-xs text-content-muted">A atividade continua sendo gerada como Formulário, revisada e então publicada no Google Classroom.</p><div className="flex flex-wrap gap-2"><Link href="/atividades?modo=acompanhar&aba=fila" className="min-h-10 rounded bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover">Acompanhar na fila</Link><button type="button" onClick={() => { setJobId(null); setPlannedCounts({}) }} className="min-h-10 rounded border border-border bg-surface px-4 py-2 text-sm font-medium text-content-primary hover:bg-surface-subtle">Criar outra atividade</button></div></div>

  return <form onSubmit={submit} className="space-y-6">{recoverySkill && <div className="rounded border border-status-info-border bg-status-info-surface p-4 text-sm text-status-info-content"><p className="font-semibold">Atividade de recuperação para {recoveryStudent || 'o aluno selecionado'}</p><p className="mt-1">O relatório indicou ausência de domínio em {recoverySkill}. O recorte e a habilidade já foram preenchidos; revise a quantidade de questões antes de enviar para a fila.</p></div>}<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"><div><label className={labelClassName}>Segmento</label><select value={segment} onChange={(event) => changeSegment(event.target.value as Segment)} className={fieldClassName}>{ACTIVITY_SEGMENTS.map((item) => <option key={item} value={item}>{SEGMENT_LABELS[item]}</option>)}</select></div><div><label className={labelClassName}>Série</label><select value={gradeYear} onChange={(event) => setGradeYear(Number(event.target.value))} className={fieldClassName}>{SEGMENT_GRADES[segment].map((grade) => <option key={grade} value={grade}>{grade}º ano</option>)}</select></div><div><label className={labelClassName}>Disciplina</label><select value={subject} onChange={(event) => setSubject(event.target.value)} className={fieldClassName}>{subjectOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div><label className={labelClassName}>Bimestre</label><select value={bimester} onChange={(event) => setBimester(event.target.value ? Number(event.target.value) : '')} className={fieldClassName}><option value="">Todos do planejamento</option>{[1, 2, 3, 4].map((item) => <option key={item} value={item}>{item}º bimestre</option>)}</select></div><div><label className={labelClassName}>Ano letivo</label><input type="number" min={2020} max={2100} value={academicYear} onChange={(event) => setAcademicYear(Number(event.target.value))} className={fieldClassName} /></div><div><label className={labelClassName}>Turma (opcional)</label><input value={classLabel} onChange={(event) => setClassLabel(event.target.value)} placeholder={`${gradeYear}º ano A`} className={fieldClassName} /></div><div><label className={labelClassName}>Questões</label><input type="number" min={1} max={30} value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} className={fieldClassName} /><p className="mt-1 text-xs text-content-muted">De 1 a 30; revisão docente obrigatória.</p></div></div>
    {courses.length > 0 && <section className="rounded-lg border border-border bg-surface p-5 shadow-soft"><h2 className="text-base font-semibold text-content-primary">Turma do Google Classroom</h2><p className="mt-1 text-sm text-content-secondary">A turma vinculada será usada na publicação do Formulário após a aprovação.</p><select value={classroomCourseId} onChange={(event) => chooseCourse(event.target.value)} className={`${fieldClassName} max-w-xl`}><option value="">Escolher depois</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}{course.section ? ` — ${course.section}` : ''}</option>)}</select></section>}
    <section className="rounded-lg border border-border bg-surface p-5 shadow-soft"><fieldset><legend className="text-base font-semibold text-content-primary">Matriz BNCC da atividade</legend><div className="mt-1 flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-content-secondary">Distribua as questões pelas habilidades do currículo da turma e do recorte selecionados.</p><div className="flex items-center gap-2"><span className={matrixTotal === questionCount ? 'text-xs font-semibold text-harmonia-green' : 'text-xs font-semibold text-status-warning-content'}>{matrixTotal} de {questionCount} questão(ões) planejada(s)</span><button type="button" onClick={balanceSelectedSkills} disabled={!selectedPlan.length} className="rounded border border-border bg-surface px-2.5 py-1 text-xs font-medium text-content-secondary disabled:opacity-50">Equilibrar selecionadas</button></div></div>{skillsError && <p role="alert" className="mt-3 rounded border border-status-danger/40 bg-status-danger/10 p-3 text-sm text-content-primary">{skillsError}</p>}{skillsLoading ? <p className="mt-3 text-sm text-content-muted">Lendo as habilidades do currículo…</p> : <div className="mt-4 max-h-[30rem] space-y-3 overflow-y-auto pr-1">{skills.map((skill) => { const count = plannedCounts[skill.code] ?? 0; const selected = count > 0; return <article key={skill.code} className={`rounded-xl border p-3 ${selected ? 'border-action-primary bg-action-primary/10' : 'border-border bg-surface-raised'}`}><div className="min-w-0"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-content-primary">{skill.code}</p>{skill.description && <p className="mt-0.5 text-xs text-content-secondary">{skill.description}</p>}{skill.chapters.length > 0 && <p className="mt-1 text-[11px] text-content-muted">{skill.chapters.join(' · ')}</p>}</div><button type="button" aria-label={`Zerar questões de ${skill.code}`} title="Zerar" onClick={() => setPlannedCount(skill.code, 0)} disabled={!count} className="rounded-full border border-border bg-surface p-2 text-content-secondary transition-colors hover:border-border-strong hover:text-action-primary disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={14} aria-hidden="true" /></button></div><div className="mt-3 flex items-center gap-3"><div role="slider" tabIndex={0} aria-label={`Quantidade de questões para ${skill.code}`} aria-valuemin={0} aria-valuemax={questionCount} aria-valuenow={count} aria-valuetext={`${count} questão(ões)`} onPointerDown={(event) => { draggingSkillRef.current = skill.code; event.currentTarget.setPointerCapture(event.pointerId); setPlannedCount(skill.code, questionsFromPointer(event.currentTarget, event.clientX, questionCount)) }} onPointerMove={(event) => { if (draggingSkillRef.current === skill.code) setPlannedCount(skill.code, questionsFromPointer(event.currentTarget, event.clientX, questionCount)) }} onPointerUp={(event) => { draggingSkillRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { draggingSkillRef.current = null }} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); setPlannedCount(skill.code, count + 1) } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); setPlannedCount(skill.code, count - 1) } else if (event.key === 'Home') { event.preventDefault(); setPlannedCount(skill.code, 0) } else if (event.key === 'End') { event.preventDefault(); setPlannedCount(skill.code, questionCount) } }} style={{ touchAction: 'none' }} className="relative flex h-8 flex-1 cursor-ew-resize items-center overflow-visible rounded-full bg-surface ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><div className="relative h-full" style={{ width: `${questionCount > 0 ? (count / questionCount) * 100 : 0}%`, minWidth: count > 0 ? '1.9rem' : 0 }}><div className="flex h-full items-center justify-end rounded-full pr-3" style={{ backgroundColor: 'rgb(var(--color-action-primary))' }}>{count > 0 && <span className="text-xs font-semibold text-action-primary-foreground">{count}</span>}</div><span aria-hidden="true" className="absolute right-0 top-1/2 h-5 w-5 -translate-y-1/2 translate-x-1/2 rounded-full border-2 border-surface shadow-soft" style={{ backgroundColor: 'rgb(var(--color-action-primary))' }} /></div></div><span className="min-w-20 rounded-full bg-harmonia-green/10 px-3 py-1.5 text-center text-xs font-semibold text-harmonia-green">{count} questão(ões)</span></div></div></article> })}{!skills.length && !skillsError && <p className="text-sm text-content-muted">Nenhuma habilidade BNCC foi encontrada nesse recorte.</p>}</div>}</fieldset></section>
    {matrixTotal !== questionCount && <p className="rounded border border-status-warning-border bg-status-warning-surface p-3 text-sm text-status-warning-content">A matriz deve totalizar exatamente {questionCount} questão(ões) antes de gerar a atividade.</p>}{error && <div role="alert" className="rounded border border-status-danger/40 bg-status-danger/10 p-3 text-sm text-content-primary">{error}</div>}<button type="submit" disabled={submitting || matrixTotal !== questionCount || skillsLoading} className="min-h-10 rounded bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:cursor-not-allowed disabled:opacity-60">{submitting ? 'Adicionando…' : 'Gerar atividade (fila)'}</button></form>
}
