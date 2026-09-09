'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import type { CorrectionAnswer } from '@/types/correction'
import { totalGrade } from '@/lib/corrections/totalGrade'

type Course = { id: string; name: string; section: string | null; room: string | null; alternateLink: string }
type Exam = {
  id: number
  subject: string
  gradeYear: number
  bimester: number | null
  status: string
  classroomCourseId: string | null
}
type Correction = { status: 'pendente' | 'revisado'; classroomStudentId: string | null; answers: CorrectionAnswer[] }
type LaunchResult = { granted: number; skippedPending: number; skippedNoRoster: number; errors: Array<{ studentName: string; message: string }> }

const STATUS_LABELS: Record<string, string> = { aplicado: 'Aplicado', corrigido: 'Corrigido' }

export default function TurmaDetail({ courseId }: { courseId: string }) {
  const [course, setCourse] = useState<Course | null>(null)
  const [exams, setExams] = useState<Exam[] | null>(null)
  const [selectedExamId, setSelectedExamId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [googleErrorKind, setGoogleErrorKind] = useState<'google_not_connected' | 'reauth_required' | null>(null)

  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ examId: number; imported: number } | null>(null)

  const [summary, setSummary] = useState<{ eligible: number; pending: number; noRoster: number } | null>(null)
  const [showLaunchConfirm, setShowLaunchConfirm] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [launchResult, setLaunchResult] = useState<LaunchResult | null>(null)

  async function loadAll() {
    try {
      const [coursesRes, examsRes] = await Promise.all([
        fetch('/api/classroom/courses').then((r) => r.json()),
        fetch('/api/exams?examKind=prova').then((r) => r.json()),
      ])
      if (coursesRes.error) {
        if (coursesRes.error === 'google_not_connected' || coursesRes.error === 'reauth_required') setGoogleErrorKind(coursesRes.error)
        else setError(coursesRes.message ?? 'Erro ao carregar turma.')
        return
      }
      const found = (coursesRes.courses as Course[]).find((c) => c.id === courseId)
      setCourse(found ?? null)

      if (examsRes.error) throw new Error(examsRes.error)
      const candidates = (examsRes.exams as Exam[]).filter(
        (e) => ['aplicado', 'corrigido'].includes(e.status) && (e.classroomCourseId === null || e.classroomCourseId === courseId),
      )
      setExams(candidates)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar turma.')
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  useEffect(() => {
    setImportResult(null)
    setLaunchResult(null)
    setShowLaunchConfirm(false)
    setSummary(null)
    if (!selectedExamId) return

    fetch(`/api/exams/${selectedExamId}/corrections`)
      .then((r) => r.json())
      .then((body) => {
        if (body.error) return
        const corrections = body.corrections as Correction[]
        const eligible = corrections.filter((c) => c.status === 'revisado' && c.classroomStudentId && totalGrade(c.answers) !== null).length
        const pending = corrections.filter((c) => c.status !== 'revisado').length
        const noRoster = corrections.filter((c) => c.status === 'revisado' && !c.classroomStudentId).length
        setSummary({ eligible, pending, noRoster })
      })
      .catch(() => {})
  }, [selectedExamId])

  async function importForExam() {
    if (!selectedExamId) return
    setImporting(true)
    setError(null)
    setImportResult(null)
    try {
      const exam = exams?.find((e) => String(e.id) === selectedExamId)
      if (exam && exam.classroomCourseId !== courseId) {
        const linkRes = await fetch(`/api/exams/${selectedExamId}/link-course`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ classroomCourseId: courseId }),
        })
        const linkBody = await linkRes.json()
        if (!linkRes.ok) throw new Error(linkBody.error ?? 'Erro ao vincular turma.')
      }

      const res = await fetch(`/api/exams/${selectedExamId}/corrections/import`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        if (body.error === 'google_not_connected' || body.error === 'reauth_required') setGoogleErrorKind(body.error)
        throw new Error(body.message ?? body.error ?? 'Erro ao importar alunos.')
      }
      setImportResult({ examId: Number(selectedExamId), imported: body.imported })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao importar alunos.')
    } finally {
      setImporting(false)
    }
  }

  async function launchGrades() {
    if (!selectedExamId) return
    setLaunching(true)
    setError(null)
    try {
      const res = await fetch(`/api/exams/${selectedExamId}/return-grades`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        if (body.error === 'google_not_connected' || body.error === 'reauth_required') setGoogleErrorKind(body.error)
        throw new Error(body.message ?? body.error ?? 'Erro ao lançar notas.')
      }
      setLaunchResult(body)
      setShowLaunchConfirm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao lançar notas.')
    } finally {
      setLaunching(false)
    }
  }

  if (googleErrorKind) {
    return (
      <div className="rounded border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
        <p>{googleErrorKind === 'reauth_required' ? 'Sua conexão com o Google expirou.' : 'Conecte sua conta Google.'}</p>
        <button
          type="button"
          onClick={() => signIn('google', { callbackUrl: `/turmas/${courseId}` })}
          className="mt-4 rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white"
        >
          {googleErrorKind === 'reauth_required' ? 'Entrar novamente com Google' : 'Conectar minha conta Google'}
        </button>
      </div>
    )
  }

  if (!exams) return <p className="text-sm text-neutral-500">Carregando…</p>

  return (
    <div className="space-y-6">
      <div>
        <Link href="/turmas" className="text-sm text-neutral-500 underline">← Minhas Turmas</Link>
        <h1 className="mt-2 text-lg font-semibold">{course?.name ?? 'Turma'}</h1>
        {course?.section && <p className="text-sm text-neutral-500">{course.section}</p>}
        {course && (
          <a href={course.alternateLink} target="_blank" rel="noopener noreferrer" className="text-sm text-harmonia-green underline">
            Abrir no Google Classroom ↗
          </a>
        )}
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {exams.length === 0 ? (
        <p className="text-sm text-neutral-500">Nenhuma prova aplicada dessa turma ainda.</p>
      ) : (
        <>
          <div className="rounded border border-neutral-200 bg-white p-4">
            <label className="text-sm font-medium">Prova</label>
            <select
              value={selectedExamId}
              onChange={(e) => setSelectedExamId(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-2 text-sm"
            >
              <option value="">Selecione a prova…</option>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.subject} — {e.gradeYear}º ano{e.bimester ? ` — ${e.bimester}º bim.` : ''} ({STATUS_LABELS[e.status] ?? e.status})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded border border-neutral-200 bg-white p-4">
              <p className="font-medium text-neutral-900">Importar alunos</p>
              <p className="mt-1 text-xs text-neutral-500">Traz o roster da turma pra dentro da correção dessa prova.</p>
              <button
                type="button"
                onClick={importForExam}
                disabled={importing || !selectedExamId}
                className="mt-3 w-full rounded bg-harmonia-green px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {importing ? 'Importando…' : 'Importar alunos'}
              </button>
              {importResult && (
                <p className="mt-2 text-xs text-harmonia-green">
                  {importResult.imported} aluno(s) importado(s).{' '}
                  <Link href={`/gerar/${importResult.examId}/corrigir`} className="underline">Ir pra correção →</Link>
                </p>
              )}
            </div>

            <div className="rounded border border-neutral-200 bg-white p-4">
              <p className="font-medium text-neutral-900">Lançar notas no Classroom</p>
              <p className="mt-1 text-xs text-neutral-500">Cria a atividade (se ainda não existir) e devolve a nota de quem já está &quot;Revisado&quot;.</p>

              {selectedExamId && summary && (
                <p className="mt-2 text-xs text-neutral-500">
                  {summary.eligible} pronto(s) pra lançar
                  {summary.pending > 0 && ` · ${summary.pending} ainda pendente(s) (serão pulados)`}
                  {summary.noRoster > 0 && ` · ${summary.noRoster} revisado(s) sem vínculo com o roster`}
                </p>
              )}

              {!showLaunchConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowLaunchConfirm(true)}
                  disabled={!selectedExamId || !summary || summary.eligible === 0}
                  className="mt-3 w-full rounded bg-harmonia-green px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  Lançar notas no Classroom
                </button>
              ) : (
                <div className="mt-3 space-y-2 rounded border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs text-amber-800">
                    Isso vai tornar {summary?.eligible} nota(s) visível(is) pros alunos no Classroom agora. Confirma?
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={launchGrades}
                      disabled={launching}
                      className="rounded bg-harmonia-green px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                    >
                      {launching ? 'Lançando…' : 'Confirmar lançamento'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowLaunchConfirm(false)}
                      disabled={launching}
                      className="rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {launchResult && (
                <div className="mt-2 text-xs">
                  <p className="text-harmonia-green">{launchResult.granted} nota(s) lançada(s) com sucesso.</p>
                  {launchResult.errors.length > 0 && (
                    <ul className="mt-1 list-disc pl-4 text-red-600">
                      {launchResult.errors.map((e, i) => (
                        <li key={i}>{e.studentName}: {e.message}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
