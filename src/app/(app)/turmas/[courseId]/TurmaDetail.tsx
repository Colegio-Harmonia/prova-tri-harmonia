'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'

type Course = { id: string; name: string; section: string | null; room: string | null; alternateLink: string }
type Exam = { id: number; subject: string; gradeYear: number; bimester: number | null; status: string; createdAt: string }
type Student = { classroomStudentId: string; name: string; email: string | null; photoUrl: string | null; corrected: number; averageGrade: number | null }
type Data = { course: Course; exams: Exam[]; students: Student[]; performance: { studentCount: number; correctedStudents: number; averageGrade: number | null }; photoAuthorizationRequired: boolean }
type ErrorState = { kind: 'google_not_connected' | 'reauth_required' | 'other'; message: string }

const STATUS_LABELS: Record<string, string> = {
  rascunho: 'Em preparação', em_revisao: 'Aguardando aprovação', aprovada: 'Aprovada', impressa: 'Impressa', aplicado: 'Aplicada', corrigido: 'Corrigida',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

function Initials({ name }: { name: string }) {
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-harmonia-green/10 text-xs font-semibold text-harmonia-green">{initials || '?'}</span>
}

export default function TurmaDetail({ courseId }: { courseId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<ErrorState | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/turmas/${courseId}`)
      .then(async (response) => {
        const body = await response.json()
        if (cancelled) return
        if (!response.ok) {
          const kind = body.error === 'google_not_connected' || body.error === 'reauth_required' ? body.error : 'other'
          setError({ kind, message: body.message ?? body.error ?? 'Não foi possível carregar a turma.' })
          return
        }
        setData(body)
      })
      .catch(() => !cancelled && setError({ kind: 'other', message: 'Não foi possível carregar a turma.' }))
    return () => { cancelled = true }
  }, [courseId])

  if (error) {
    const needsGoogle = error.kind === 'google_not_connected' || error.kind === 'reauth_required'
    return <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-900">
      <p>{error.message}</p>
      {needsGoogle && <button type="button" onClick={() => signIn('google', { callbackUrl: `/turmas/${courseId}` })} className="mt-4 rounded-md bg-harmonia-green px-4 py-2 font-medium text-white">{error.kind === 'reauth_required' ? 'Entrar novamente com Google' : 'Conectar minha conta Google'}</button>}
      {!needsGoogle && <Link href="/turmas" className="mt-4 inline-block text-harmonia-green underline">Voltar para turmas</Link>}
    </div>
  }
  if (!data) return <p className="text-sm text-content-secondary">Carregando turma…</p>

  const { course, exams, students, performance } = data
  return <div className="space-y-7">
    <div>
      <Link href="/turmas" className="text-sm text-content-secondary underline">← Turmas</Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold text-content-primary">{course.name}</h1>{course.section && <p className="mt-1 text-sm text-content-secondary">{course.section}</p>}</div>
        <a href={course.alternateLink} target="_blank" rel="noopener noreferrer" className="rounded-md border border-border px-3 py-2 text-sm font-medium text-content-primary hover:bg-surface-subtle">Abrir no Classroom ↗</a>
      </div>
    </div>

    {data.photoAuthorizationRequired && <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <div><p className="font-semibold">Autorize as fotos do Classroom</p><p className="mt-1">O Google pede uma permissão específica para exibir as fotos dos alunos. Reconecte sua conta uma vez para liberá-las.</p></div>
      <button type="button" onClick={() => signIn('google', { callbackUrl: `/turmas/${courseId}` })} className="shrink-0 rounded-md bg-harmonia-green px-3 py-2 font-medium text-white">Autorizar fotos</button>
    </section>}

    <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-border bg-surface p-4"><p className="text-sm text-content-secondary">Provas vinculadas</p><p className="mt-1 text-2xl font-semibold text-content-primary">{exams.length}</p></div>
      <div className="rounded-xl border border-border bg-surface p-4"><p className="text-sm text-content-secondary">Alunos no Classroom</p><p className="mt-1 text-2xl font-semibold text-content-primary">{performance.studentCount}</p></div>
      <div className="rounded-xl border border-border bg-surface p-4"><p className="text-sm text-content-secondary">Média da turma</p><p className="mt-1 text-2xl font-semibold text-content-primary">{performance.averageGrade === null ? '—' : performance.averageGrade.toFixed(1)}</p><p className="text-xs text-content-muted">{performance.correctedStudents} aluno(s) com correção</p></div>
    </section>

    <section className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-5 py-4"><h2 className="font-semibold text-content-primary">Provas da turma</h2><p className="mt-1 text-sm text-content-secondary">Da mais recente para a mais antiga.</p></div>
      <ul className="divide-y divide-border">
        {exams.map((exam) => <li key={exam.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div><p className="font-medium text-content-primary">{exam.subject} · {exam.gradeYear}º ano{exam.bimester ? ` · ${exam.bimester}º bimestre` : ''}</p><p className="mt-1 text-xs text-content-muted">Criada em {formatDate(exam.createdAt)}</p></div>
          <div className="flex items-center gap-3"><span className="rounded-full bg-surface-subtle px-2.5 py-1 text-xs font-medium text-content-secondary">{STATUS_LABELS[exam.status] ?? exam.status}</span><Link href={`/gerar/${exam.id}/revisar`} className="text-sm font-medium text-harmonia-green hover:underline">Abrir prova →</Link></div>
        </li>)}
      </ul>
    </section>

    <section className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-5 py-4"><h2 className="font-semibold text-content-primary">Integrantes e desempenho</h2><p className="mt-1 text-sm text-content-secondary">Fotos e lista atualizadas pelo Google Classroom. A média considera somente provas já corrigidas.</p></div>
      {students.length === 0 ? <p className="px-5 py-6 text-sm text-content-secondary">Nenhum aluno matriculado nesta turma no Classroom.</p> : <ul className="divide-y divide-border">
        {students.map((student) => <li key={student.classroomStudentId} className="flex items-center gap-3 px-5 py-3">
          {student.photoUrl ? <img src={`/api/turmas/${courseId}/students/${encodeURIComponent(student.classroomStudentId)}/photo`} alt="" className="h-10 w-10 shrink-0 rounded-full bg-surface-subtle object-cover" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : <Initials name={student.name} />}
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-content-primary">{student.name}</p>{student.email && <p className="truncate text-xs text-content-muted">{student.email}</p>}</div>
          <div className="text-right"><p className="text-sm font-semibold text-content-primary">{student.averageGrade === null ? '—' : student.averageGrade.toFixed(1)}</p><p className="text-xs text-content-muted">{student.corrected} corrigida{student.corrected === 1 ? '' : 's'}</p></div>
        </li>)}
      </ul>}
    </section>
  </div>
}
