'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { SEGMENT_SUBJECTS } from '@/config/subjects'
import { getEnemAreaForSubject } from '@/config/enemAreaMap'

// Criador de Atividades de Reforço por Habilidade INEP (Módulo 3).
// Seleção manual das habilidades ou sugestão automática pelas deficiências
// reais detectadas nas correções revisadas — a sugestão é pré-seleção
// editável, a decisão final é sempre do professor.

type SkillOption = { code: string; description: string; competencyNumber: number }
type Suggestion = { code: string; description: string | null; attempts: number; errorRatePercent: number }
type ClassroomCourse = { id: string; name: string; section: string | null }

// Só disciplinas com área ENEM correspondente entram no reforço.
const EM_SUBJECTS = SEGMENT_SUBJECTS['ensino-medio'].filter((s) => getEnemAreaForSubject(s))

const MAX_SKILLS = 10
const ENEM_QUESTION_YEARS = Array.from({ length: 17 }, (_, index) => 2025 - index)
const fieldClassName = 'mt-1 min-h-10 w-full rounded border border-border bg-surface px-3 py-2 text-sm text-content-primary shadow-soft placeholder:text-content-muted transition-colors hover:border-border-strong focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/25'
const labelClassName = 'text-sm font-semibold text-content-primary'

export default function ReforcoForm() {
  const [gradeYear, setGradeYear] = useState(3)
  const [subject, setSubject] = useState(EM_SUBJECTS[0])
  const [classLabel, setClassLabel] = useState('')
  const [academicYear, setAcademicYear] = useState(new Date().getFullYear())
  const [enemQuestionYear, setEnemQuestionYear] = useState<number | ''>('')
  const [questionCount, setQuestionCount] = useState(15)
  const [skills, setSkills] = useState<SkillOption[]>([])
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const [suggestionNote, setSuggestionNote] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [courses, setCourses] = useState<ClassroomCourse[]>([])
  const [classroomCourseId, setClassroomCourseId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enqueuedJobId, setEnqueuedJobId] = useState<number | null>(null)

  const area = getEnemAreaForSubject(subject)

  useEffect(() => {
    setSelectedSkills([])
    setSuggestions([])
    setSuggestionNote(null)
    if (!area) {
      setSkills([])
      return
    }
    fetch('/api/enem-bank/skills?area=' + encodeURIComponent(area) + '&subject=' + encodeURIComponent(subject))
      .then((res) => res.json())
      .then((data) => setSkills(data.skills ?? []))
      .catch(() => setSkills([]))
  }, [area, subject])

  // Turmas do Classroom são opcionais aqui — sem conexão Google o select
  // simplesmente não aparece (a publicação pode ser feita depois).
  useEffect(() => {
    fetch('/api/classroom/courses')
      .then((res) => (res.ok ? res.json() : { courses: [] }))
      .then((data) => setCourses(data.courses ?? []))
      .catch(() => setCourses([]))
  }, [])

  function toggleSkill(code: string) {
    setSelectedSkills((prev) => {
      if (prev.includes(code)) return prev.filter((c) => c !== code)
      if (prev.length >= MAX_SKILLS) return prev
      return [...prev, code]
    })
  }

  async function suggestSkills() {
    setSuggesting(true)
    setSuggestionNote(null)
    setError(null)
    try {
      const res = await fetch(`/api/reinforcement/suggest-skills?subject=${encodeURIComponent(subject)}&gradeYear=${gradeYear}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao buscar sugestões.')
      setSuggestions(data.suggestions ?? [])
      if (data.suggestions?.length) {
        setSelectedSkills(data.suggestions.slice(0, MAX_SKILLS).map((s: Suggestion) => s.code))
        setSuggestionNote('Habilidades pré-selecionadas pelas maiores taxas de erro nas correções revisadas — ajuste como quiser antes de gerar.')
      } else {
        setSuggestionNote(data.sampleNote ?? 'Sem dados suficientes — selecione manualmente.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao buscar sugestões.')
    } finally {
      setSuggesting(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/reinforcement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gradeYear,
          academicYear,
          subject,
          enemSkills: selectedSkills,
          ...(enemQuestionYear ? { enemQuestionYear } : {}),
          questionCount,
          ...(classLabel.trim() ? { classLabel: classLabel.trim() } : {}),
          ...(classroomCourseId ? { classroomCourseId } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao adicionar à fila.')
      setEnqueuedJobId(data.jobId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao adicionar à fila.')
    } finally {
      setSubmitting(false)
    }
  }

  if (enqueuedJobId) {
    return (
      <div className="space-y-4 rounded border border-harmonia-green/30 bg-harmonia-green/5 p-6">
        <p className="text-sm font-semibold text-action-primary">Atividade de reforço adicionada à fila de geração.</p>
        <p className="text-sm text-content-secondary">
          {subject} — {gradeYear}º EM · habilidades {selectedSkills.join(', ')} · {questionCount} questões do banco ENEM{enemQuestionYear ? ` de ${enemQuestionYear}` : ''}.
        </p>
        <p className="text-xs text-content-muted">
          A seleção das questões e o gabarito comentado rodam em segundo plano. Depois, revise e finalize você mesmo para gerar os 3 documentos e, se quiser, publique no Google Classroom.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/reforco?modo=acompanhar&aba=fila" className="min-h-10 rounded bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover">
            Acompanhar reforços na fila
          </Link>
          <button onClick={() => { setEnqueuedJobId(null); setSelectedSkills([]) }} className="min-h-10 rounded border border-border bg-surface px-4 py-2 text-sm font-medium text-content-primary hover:bg-surface-subtle">
            Criar outra atividade
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1">
          <label className={labelClassName}>Série (EM)</label>
          <select value={gradeYear} onChange={(e) => setGradeYear(Number(e.target.value))} className={fieldClassName}>
            {[1, 2, 3].map((g) => <option key={g} value={g}>{g}º ano EM</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className={labelClassName}>Disciplina</label>
          <select value={subject} onChange={(e) => setSubject(e.target.value)} className={fieldClassName}>
            {EM_SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {area && <p className="text-xs text-content-muted">Área ENEM: {area}</p>}
        </div>
        <div className="space-y-1">
          <label className={labelClassName}>Turma (opcional)</label>
          <input type="text" placeholder={`Ex: ${gradeYear}º EM A`} value={classLabel} onChange={(e) => setClassLabel(e.target.value)} className={fieldClassName} />
        </div>
        <div className="space-y-1">
          <label className={labelClassName}>Ano letivo</label>
          <input type="number" min={2020} max={2100} value={academicYear} onChange={(e) => setAcademicYear(Number(e.target.value))} className={fieldClassName} />
        </div>
        <div className="space-y-1">
          <label className={labelClassName}>Ano das questões ENEM</label>
          <select value={enemQuestionYear} onChange={(e) => setEnemQuestionYear(e.target.value ? Number(e.target.value) : '')} className={fieldClassName}>
            <option value="">Todos os anos</option>
            {ENEM_QUESTION_YEARS.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
          <p className="text-xs text-content-muted">Use 2025 para testar os itens recém-importados.</p>
        </div>
        <div className="space-y-1">
          <label className={labelClassName}>Nº de exercícios</label>
          <input type="number" min={3} max={30} value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))} className={fieldClassName} />
          <p className="text-xs text-content-muted">3 a 30, extraídos do banco ENEM</p>
        </div>
      </div>

      {courses.length > 0 && (
        <section aria-labelledby="classroom-course-heading" className="rounded-lg border border-border bg-surface p-5 shadow-soft">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <h2 id="classroom-course-heading" className="text-base font-semibold text-content-primary">Turma do Google Classroom</h2>
            <span className="text-xs text-content-muted">Opcional</span>
          </div>
          <p className="mt-1 text-sm text-content-secondary">Deixe a atividade vinculada para publicar com um clique após a aprovação.</p>
          <select aria-label="Turma do Google Classroom" value={classroomCourseId} onChange={(e) => setClassroomCourseId(e.target.value)} className={`${fieldClassName} max-w-xl`}>
            <option value="">Escolher depois</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}{c.section ? ` — ${c.section}` : ''}</option>)}
          </select>
        </section>
      )}

      <section aria-labelledby="enem-skills-heading" className="rounded-lg border border-border bg-surface p-5 shadow-soft">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h2 id="enem-skills-heading" className="text-base font-semibold text-content-primary">Habilidades INEP a desenvolver</h2>
          <span className="text-xs text-content-muted">Selecione até {MAX_SKILLS} habilidades</span>
        </div>
        <p className="mt-1 text-sm text-content-secondary">Use a sugestão baseada nas correções revisadas ou faça a seleção manual.</p>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={suggestSkills} disabled={suggesting} className="min-h-10 rounded border border-action-primary bg-surface px-3 py-1.5 text-sm font-medium text-action-primary hover:bg-action-primary/10 disabled:cursor-not-allowed disabled:opacity-60">
            {suggesting ? 'Analisando correções…' : 'Sugerir pelas deficiências detectadas'}
          </button>
          <span className="text-xs text-content-muted">{selectedSkills.length}/{MAX_SKILLS} selecionadas</span>
        </div>

        {suggestionNote && <p className="mb-3 rounded border border-status-warning/40 bg-status-warning/10 p-3 text-xs text-content-primary">{suggestionNote}</p>}
        {suggestions.length > 0 && (
          <p className="mb-3 text-xs text-content-secondary">
            Piores desempenhos: {suggestions.map((s) => `${s.code} (${s.errorRatePercent}% de erro em ${s.attempts})`).join(' · ')}
          </p>
        )}

        <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {skills.map((skill) => (
            <label key={skill.code} className={`flex cursor-pointer items-start gap-2 rounded border p-3 text-xs transition-colors ${selectedSkills.includes(skill.code) ? 'border-action-primary bg-action-primary/10' : 'border-border bg-surface-raised hover:bg-surface-subtle'}`}>
              <input type="checkbox" checked={selectedSkills.includes(skill.code)} onChange={() => toggleSkill(skill.code)} className="mt-0.5 accent-action-primary" />
              <span>
                <span className="font-semibold text-content-primary">{skill.code}</span> <span className="text-content-muted">(C{skill.competencyNumber})</span>
                <span className="block text-content-secondary">{skill.description}</span>
              </span>
            </label>
          ))}
          {!skills.length && <p className="text-xs text-content-muted">Carregando habilidades da área…</p>}
        </div>
      </section>

      {error && <div role="alert" className="rounded border border-status-danger/40 bg-status-danger/10 p-3 text-sm text-content-primary">{error}</div>}

      <button
        type="submit"
        disabled={submitting || selectedSkills.length === 0}
        className="min-h-10 rounded bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Adicionando…' : 'Gerar atividade de reforço (fila)'}
      </button>
    </form>
  )
}
