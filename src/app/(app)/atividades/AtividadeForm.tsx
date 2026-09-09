'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { SEGMENT_GRADES, SEGMENT_LABELS, SEGMENT_SUBJECTS } from '@/config/subjects'
import type { Segment } from '@/types/exam'

type BnccSkill = { code: string; description: string | null }
type ClassroomCourse = { id: string; name: string; section: string | null }

const ACTIVITY_SEGMENTS: Segment[] = ['anos-iniciais', 'anos-finais', 'ensino-medio']
const fieldClassName = 'mt-1 min-h-10 w-full rounded border border-border bg-surface px-3 py-2 text-sm text-content-primary shadow-soft transition-colors hover:border-border-strong focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/25'
const labelClassName = 'text-sm font-semibold text-content-primary'

function initialGrade(segment: Segment) { return SEGMENT_GRADES[segment][0] }

export default function AtividadeForm() {
  const [segment, setSegment] = useState<Segment>('anos-iniciais')
  const [gradeYear, setGradeYear] = useState(initialGrade('anos-iniciais'))
  const [subject, setSubject] = useState(SEGMENT_SUBJECTS['anos-iniciais'][0])
  const [academicYear, setAcademicYear] = useState(new Date().getFullYear())
  const [bimester, setBimester] = useState<number | ''>('')
  const [classLabel, setClassLabel] = useState('')
  const [questionCount, setQuestionCount] = useState(12)
  const [skills, setSkills] = useState<BnccSkill[]>([])
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillsError, setSkillsError] = useState<string | null>(null)
  const [courses, setCourses] = useState<ClassroomCourse[]>([])
  const [classroomCourseId, setClassroomCourseId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<number | null>(null)
  const subjectOptions = useMemo(() => SEGMENT_SUBJECTS[segment], [segment])

  useEffect(() => {
    setSelectedCodes([]); setSkills([]); setSkillsError(null); setSkillsLoading(true)
    fetch('/api/curriculum/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segment, gradeYear, subject, ...(bimester ? { bimester } : {}) }) })
      .then(async (res) => { const data = await res.json(); if (!res.ok) throw new Error(data.error ?? 'Não foi possível ler o currículo.'); const map = new Map<string, string | null>(); for (const unit of data.units ?? []) { if (unit.habilidades?.status !== 'mapeado') continue; for (const skill of unit.habilidades.skills ?? []) map.set(String(skill.code).toUpperCase(), skill.description ?? null) }; setSkills([...map.entries()].map(([code, description]) => ({ code, description })).sort((a, b) => a.code.localeCompare(b.code, 'pt-BR'))) })
      .catch((err) => setSkillsError(err instanceof Error ? err.message : 'Não foi possível ler o currículo.'))
      .finally(() => setSkillsLoading(false))
  }, [segment, gradeYear, subject, bimester])

  useEffect(() => { fetch('/api/classroom/courses').then((res) => (res.ok ? res.json() : { courses: [] })).then((data) => setCourses(data.courses ?? [])).catch(() => setCourses([])) }, [])

  function changeSegment(nextSegment: Segment) { setSegment(nextSegment); setGradeYear(initialGrade(nextSegment)); setSubject(SEGMENT_SUBJECTS[nextSegment][0]) }
  function toggleCode(code: string) { setSelectedCodes((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]) }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSubmitting(true); setError(null)
    try {
      const response = await fetch('/api/activities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segment, gradeYear, subject, academicYear, ...(bimester ? { bimester } : {}), questionCount, bnccCodes: selectedCodes, ...(classLabel.trim() ? { classLabel: classLabel.trim() } : {}), ...(classroomCourseId ? { classroomCourseId } : {}) }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Erro ao adicionar à fila.'); setJobId(data.jobId)
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao adicionar à fila.') } finally { setSubmitting(false) }
  }

  if (jobId) return <div className="space-y-4 rounded border border-harmonia-green/30 bg-harmonia-green/5 p-6"><p className="text-sm font-semibold text-action-primary">Atividade adicionada à fila de geração.</p><p className="text-sm text-content-secondary">{subject} · {gradeYear}º ano · {selectedCodes.join(', ')} · {questionCount} questões.</p><p className="text-xs text-content-muted">Depois de revisar e aprovar, publique no Classroom. As notas atribuídas pelo professor poderão ser importadas aqui.</p><div className="flex flex-wrap gap-2"><Link href="/atividades?modo=acompanhar&aba=fila" className="min-h-10 rounded bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover">Acompanhar na fila</Link><button type="button" onClick={() => { setJobId(null); setSelectedCodes([]) }} className="min-h-10 rounded border border-border bg-surface px-4 py-2 text-sm font-medium text-content-primary hover:bg-surface-subtle">Criar outra atividade</button></div></div>

  return <form onSubmit={submit} className="space-y-6"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"><div><label className={labelClassName}>Segmento</label><select value={segment} onChange={(e) => changeSegment(e.target.value as Segment)} className={fieldClassName}>{ACTIVITY_SEGMENTS.map((item) => <option key={item} value={item}>{SEGMENT_LABELS[item]}</option>)}</select></div><div><label className={labelClassName}>Série</label><select value={gradeYear} onChange={(e) => setGradeYear(Number(e.target.value))} className={fieldClassName}>{SEGMENT_GRADES[segment].map((grade) => <option key={grade} value={grade}>{grade}º ano</option>)}</select></div><div><label className={labelClassName}>Disciplina</label><select value={subject} onChange={(e) => setSubject(e.target.value)} className={fieldClassName}>{subjectOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div><label className={labelClassName}>Bimestre</label><select value={bimester} onChange={(e) => setBimester(e.target.value ? Number(e.target.value) : '')} className={fieldClassName}><option value="">Todos do planejamento</option>{[1, 2, 3, 4].map((item) => <option key={item} value={item}>{item}º bimestre</option>)}</select></div><div><label className={labelClassName}>Ano letivo</label><input type="number" min={2020} max={2100} value={academicYear} onChange={(e) => setAcademicYear(Number(e.target.value))} className={fieldClassName} /></div><div><label className={labelClassName}>Turma (opcional)</label><input value={classLabel} onChange={(e) => setClassLabel(e.target.value)} placeholder={`Ex.: ${gradeYear}º ano A`} className={fieldClassName} /></div><div><label className={labelClassName}>Questões</label><input type="number" min={12} max={15} value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))} className={fieldClassName} /><p className="mt-1 text-xs text-content-muted">12 a 15; revisão docente obrigatória.</p></div></div>
    {courses.length > 0 && <section className="rounded-lg border border-border bg-surface p-5 shadow-soft"><h2 className="text-base font-semibold text-content-primary">Turma do Google Classroom</h2><p className="mt-1 text-sm text-content-secondary">Opcional agora; será usada na publicação após a aprovação.</p><select value={classroomCourseId} onChange={(e) => setClassroomCourseId(e.target.value)} className={`${fieldClassName} max-w-xl`}><option value="">Escolher depois</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}{course.section ? ` — ${course.section}` : ''}</option>)}</select></section>}
    <section className="rounded-lg border border-border bg-surface p-5 shadow-soft"><div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-base font-semibold text-content-primary">Habilidades BNCC da atividade</h2><span className="text-xs text-content-muted">{selectedCodes.length} selecionada(s)</span></div><p className="mt-1 text-sm text-content-secondary">Essas habilidades definem o recorte de geração e aparecem na descrição publicada no Classroom.</p>{skillsError && <p role="alert" className="mt-3 rounded border border-status-danger/40 bg-status-danger/10 p-3 text-sm text-content-primary">{skillsError}</p>}{skillsLoading ? <p className="mt-3 text-sm text-content-muted">Lendo as habilidades do currículo…</p> : <div className="mt-4 grid max-h-96 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">{skills.map((skill) => <label key={skill.code} className={`flex cursor-pointer items-start gap-2 rounded border p-3 text-xs ${selectedCodes.includes(skill.code) ? 'border-action-primary bg-action-primary/10' : 'border-border bg-surface-raised hover:bg-surface-subtle'}`}><input type="checkbox" checked={selectedCodes.includes(skill.code)} onChange={() => toggleCode(skill.code)} className="mt-0.5 accent-action-primary" /><span><span className="font-semibold text-content-primary">{skill.code}</span>{skill.description && <span className="block text-content-secondary">{skill.description}</span>}</span></label>)}{!skills.length && !skillsError && <p className="text-sm text-content-muted">Nenhuma habilidade BNCC foi encontrada nesse recorte.</p>}</div>}</section>
    {error && <div role="alert" className="rounded border border-status-danger/40 bg-status-danger/10 p-3 text-sm text-content-primary">{error}</div>}<button type="submit" disabled={submitting || selectedCodes.length === 0 || skillsLoading} className="min-h-10 rounded bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:cursor-not-allowed disabled:opacity-60">{submitting ? 'Adicionando…' : 'Gerar atividade (fila)'}</button></form>
}
