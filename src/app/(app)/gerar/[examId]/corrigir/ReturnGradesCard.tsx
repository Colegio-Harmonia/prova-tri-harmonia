'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, CloudUpload, LoaderCircle, Users } from 'lucide-react'
import { signIn } from 'next-auth/react'
import { readJsonResponse } from '@/lib/http/readJsonResponse'

type Completion = {
  expected: number
  completed: number
  reviewed: number
  absent: number
  pending: number
  withoutClassroomStudent: number
  outOfRoster: number
  ready: boolean
  classroomReady: boolean
}

type Exam = {
  classroomCourseId: string | null
  classroomCourseWorkId: string | null
}

type ClassroomCourse = { id: string; name: string; section: string | null }

type ReturnResult = {
  granted?: number
  skippedAbsent?: number
  recreatedCourseWork?: boolean
  errors?: Array<{ correctionId?: number; studentName: string; message: string }>
  error?: string
  message?: string
  completion?: Completion
}

function reasonForDisabled(completion: Completion | null, exam: Exam | null) {
  if (!exam?.classroomCourseId) return 'Vincule uma turma do Google Classroom antes de importar as notas.'
  if (!completion) return 'Carregando o status da prova.'
  if (completion.expected === 0) return 'Importe ou cadastre os alunos antes de lançar as notas.'
  if (completion.pending > 0) return `Ainda faltam ${completion.pending} aluno(s) para concluir.`
  if (completion.reviewed === 0) return 'Não há notas para importar; todos os alunos estão ausentes.'
  if (completion.outOfRoster > 0) return 'Há correções fora do roster congelado.'
  if (completion.withoutClassroomStudent > 0) return 'Há alunos corrigidos sem vínculo com o Classroom.'
  return ''
}

export default function ReturnGradesCard({ examId }: { examId: number }) {
  const [exam, setExam] = useState<Exam | null>(null)
  const [completion, setCompletion] = useState<Completion | null>(null)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ReturnResult | null>(null)
  const [courses, setCourses] = useState<ClassroomCourse[]>([])
  const [selectedCourse, setSelectedCourse] = useState('')
  const [linking, setLinking] = useState(false)
  const [needsGoogle, setNeedsGoogle] = useState(false)

  const load = useCallback(async () => {
    const [examResponse, correctionsResponse] = await Promise.all([
      fetch(`/api/exams/${examId}`),
      fetch(`/api/exams/${examId}/corrections`),
    ])
    const [examData, correctionsData] = await Promise.all([
      readJsonResponse<{ exam: Exam; error?: string }>(examResponse),
      readJsonResponse<{ completion?: Completion; error?: string }>(correctionsResponse),
    ])
    if (!examResponse.ok || !correctionsResponse.ok) {
      throw new Error(examData.error ?? correctionsData.error ?? 'Não foi possível carregar o status do Classroom.')
    }
    setExam(examData.exam)
    setCompletion(correctionsData.completion ?? null)
  }, [examId])

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o status do Classroom.')).finally(() => setLoading(false))
  }, [load])

  useEffect(() => {
    if (loading || exam?.classroomCourseId) return
    fetch('/api/classroom/courses')
      .then(async (response) => {
        const body = await readJsonResponse<{ courses?: ClassroomCourse[]; error?: string; message?: string }>(response)
        if (!response.ok) {
          if (body.error === 'google_not_connected' || body.error === 'reauth_required') setNeedsGoogle(true)
          throw new Error(body.message ?? body.error ?? 'Não foi possível carregar as turmas.')
        }
        setCourses(body.courses ?? [])
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as turmas.'))
  }, [exam, loading])

  const disabledReason = useMemo(() => reasonForDisabled(completion, exam), [completion, exam])
  const canImport = Boolean(exam?.classroomCourseId && completion?.classroomReady && completion.reviewed > 0 && !loading && !importing)

  async function linkCourse() {
    if (!selectedCourse) return
    setLinking(true)
    setError(null)
    try {
      const response = await fetch(`/api/exams/${examId}/link-course`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroomCourseId: selectedCourse }),
      })
      const body = await readJsonResponse<{ message?: string; error?: string }>(response)
      if (!response.ok) throw new Error(body.message ?? body.error ?? 'Não foi possível vincular a turma.')
      setSelectedCourse('')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível vincular a turma.')
    } finally {
      setLinking(false)
    }
  }

  async function importGrades(correctionIds?: number[]) {
    if (!canImport) return
    const isRetry = Boolean(correctionIds?.length)
    if (!window.confirm(isRetry
      ? `O sistema tentará novamente lançar ${correctionIds?.length} nota(s) que falharam. Deseja continuar?`
      : 'As notas dos alunos corrigidos serão lançadas no Google Classroom. Alunos marcados como ausentes não receberão nota. Deseja continuar?')) return
    setImporting(true)
    setError(null)
    setMessage(null)
    setResult(null)
    try {
      const response = await fetch(`/api/exams/${examId}/return-grades`, {
        method: 'POST',
        ...(isRetry ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correctionIds }) } : {}),
      })
      const body = await readJsonResponse<ReturnResult>(response)
      if (!response.ok) {
        if (body.error === 'google_not_connected' || body.error === 'reauth_required') {
          throw new Error('Conecte novamente sua conta Google para lançar as notas.')
        }
        throw new Error(body.message ?? body.error ?? 'Não foi possível importar as notas.')
      }
      setResult(body)
      setMessage(body.message ?? (body.granted ? `${body.granted} nota(s) foram importadas para o Classroom.` : 'Nenhuma nota nova precisava ser importada.'))
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível importar as notas.')
    } finally {
      setImporting(false)
    }
  }

  const failedCorrectionIds = result?.errors?.flatMap((item) => typeof item.correctionId === 'number' ? [item.correctionId] : []) ?? []
  const hasPartialErrors = Boolean(result?.errors?.length)
  return (
    <section className="rounded-2xl border border-harmonia-green/30 bg-gradient-to-br from-harmonia-green/10 via-surface to-surface p-5 shadow-sm" aria-labelledby="return-grades-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-harmonia-green text-white shadow-sm" aria-hidden="true"><CloudUpload size={22} /></div>
          <div>
            <h2 id="return-grades-title" className="text-base font-semibold text-content-primary">Notas da prova no Google Classroom</h2>
            <p className="mt-1 max-w-2xl text-sm text-content-secondary">Conclua todas as correções ou marque os alunos ausentes. Depois, importe as notas para a turma em escala de 0 a 100.</p>
          </div>
        </div>
        {!exam?.classroomCourseId ? (
          needsGoogle ? (
            <button type="button" onClick={() => signIn('google', { callbackUrl: `/gerar/${examId}/corrigir` })} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-harmonia-green px-4 py-2 text-sm font-semibold text-harmonia-green hover:bg-harmonia-green/10">Conectar Google</button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="return-grades-course" className="sr-only">Turma do Google Classroom</label>
              <select id="return-grades-course" value={selectedCourse} onChange={(event) => setSelectedCourse(event.target.value)} disabled={loading || linking} className="min-h-10 max-w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-content-primary">
                <option value="">{loading ? 'Carregando turmas…' : 'Selecione a turma…'}</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.name}{course.section ? ` — ${course.section}` : ''}</option>)}
              </select>
              <button type="button" onClick={() => void linkCourse()} disabled={!selectedCourse || linking} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-harmonia-green px-4 py-2 text-sm font-semibold text-harmonia-green hover:bg-harmonia-green/10 disabled:cursor-not-allowed disabled:opacity-50">{linking ? <LoaderCircle size={16} className="animate-spin" /> : null}{linking ? 'Vinculando…' : 'Vincular turma'}</button>
            </div>
          )
        ) : (
          <button type="button" onClick={() => void importGrades()} disabled={!canImport} title={canImport ? 'Importar notas para o Google Classroom' : disabledReason} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-harmonia-green px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-harmonia-green/90 disabled:cursor-not-allowed disabled:opacity-50">
            {importing ? <LoaderCircle size={18} className="animate-spin" /> : <CloudUpload size={18} />}
            {importing ? 'Importando notas…' : exam.classroomCourseWorkId ? 'Atualizar notas no Classroom' : 'Importar notas para o Classroom'}
          </button>
        )}
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-4" aria-label="Resumo da conclusão da prova">
        <div className="rounded-xl border border-border bg-surface/80 px-3 py-2.5"><p className="text-xs text-content-muted">Alunos</p><p className="mt-0.5 text-lg font-semibold text-content-primary">{loading ? '—' : completion?.expected ?? 0}</p></div>
        <div className="rounded-xl border border-border bg-surface/80 px-3 py-2.5"><p className="text-xs text-content-muted">Corrigidos</p><p className="mt-0.5 text-lg font-semibold text-content-primary">{loading ? '—' : completion?.reviewed ?? 0}</p></div>
        <div className="rounded-xl border border-border bg-surface/80 px-3 py-2.5"><p className="text-xs text-content-muted">Ausentes</p><p className="mt-0.5 text-lg font-semibold text-content-primary">{loading ? '—' : completion?.absent ?? 0}</p></div>
        <div className="rounded-xl border border-border bg-surface/80 px-3 py-2.5"><p className="text-xs text-content-muted">Pendentes</p><p className={`mt-0.5 text-lg font-semibold ${completion?.pending ? 'text-amber-700' : 'text-content-primary'}`}>{loading ? '—' : completion?.pending ?? 0}</p></div>
      </div>

      {!loading && !exam?.classroomCourseId && <p className="mt-4 flex items-center gap-2 text-sm text-amber-800"><AlertTriangle size={16} /> Vincule a turma para habilitar o lançamento das notas.</p>}
      {!loading && exam?.classroomCourseId && completion?.ready && completion.classroomReady && <p className="mt-4 flex items-center gap-2 text-sm text-harmonia-green"><CheckCircle2 size={16} /> Prova concluída. {completion.absent ? `${completion.absent} aluno(s) ausente(s) serão ignorados.` : 'Todas as notas estão prontas para a turma.'}</p>}
      {!loading && exam?.classroomCourseId && !completion?.classroomReady && <p className="mt-4 flex items-center gap-2 text-sm text-amber-800"><Users size={16} /> {disabledReason}</p>}
      {message && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
      {hasPartialErrors && <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">Algumas notas não foram lançadas.</p><ul className="mt-1 list-disc pl-5">{result?.errors?.map((item) => <li key={`${item.correctionId ?? item.studentName}-${item.message}`}>{item.studentName}: {item.message}</li>)}</ul></div>{failedCorrectionIds.length > 0 && <button type="button" onClick={() => void importGrades(failedCorrectionIds)} disabled={importing} className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg border border-amber-700 px-3 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"><LoaderCircle size={15} className={importing ? 'animate-spin' : ''} />{importing ? 'Tentando…' : 'Tentar novamente'}</button>}</div></div>}
      {error && <div role="alert" className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}{error.includes('Google') && <button type="button" onClick={() => signIn('google', { callbackUrl: `/gerar/${examId}/corrigir` })} className="font-semibold underline">Conectar novamente</button>}</div>}
    </section>
  )
}
