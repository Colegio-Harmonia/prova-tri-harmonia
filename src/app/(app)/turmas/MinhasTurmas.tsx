'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'

type Course = {
  id: string
  name: string
  section: string | null
  room: string | null
  courseState: string
  alternateLink: string
  examCount: number
  appliedCount: number
}

type ErrorState = { kind: 'google_not_connected' | 'reauth_required' | 'other'; message: string }

export default function MinhasTurmas() {
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [error, setError] = useState<ErrorState | null>(null)

  useEffect(() => {
    let cancelled = false

    fetch('/api/turmas')
      .then(async (res) => {
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) {
          const kind = body.error === 'google_not_connected' || body.error === 'reauth_required' ? body.error : 'other'
          setError({ kind, message: body.message ?? 'Não foi possível carregar suas turmas.' })
          return
        }
        setCourses(body.courses)
      })
      .catch(() => {
        if (!cancelled) setError({ kind: 'other', message: 'Não foi possível carregar suas turmas.' })
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    const needsGoogle = error.kind === 'google_not_connected' || error.kind === 'reauth_required'
    return (
      <div className="rounded border border-neutral-200 bg-white p-6 text-center">
        <p className="text-sm text-neutral-600">{error.message}</p>
        {needsGoogle && (
          <button
            type="button"
            onClick={() => signIn('google', { callbackUrl: '/turmas' })}
            className="mt-4 rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white"
          >
            {error.kind === 'reauth_required' ? 'Entrar novamente com Google' : 'Conectar minha conta Google'}
          </button>
        )}
      </div>
    )
  }

  if (!courses) {
    return <p className="text-sm text-neutral-500">Carregando turmas…</p>
  }

  if (courses.length === 0) {
    return <div className="rounded-lg border border-dashed border-border bg-surface p-6 text-sm text-content-secondary">Nenhuma turma com provas vinculadas foi encontrada. Vincule uma prova a uma turma do Google Classroom para ela aparecer aqui.</div>
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {courses.map((course) => (
        <Link
          key={course.id}
          href={`/turmas/${course.id}`}
          className="rounded-xl border border-border bg-surface p-5 shadow-soft transition hover:-translate-y-0.5 hover:border-harmonia-green"
        >
          <p className="font-medium text-neutral-900">{course.name}</p>
          {course.section && <p className="mt-1 text-sm text-neutral-500">{course.section}</p>}
          {course.room && <p className="text-sm text-neutral-400">Sala {course.room}</p>}
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
            <span className="font-medium text-harmonia-green">{course.examCount} {course.examCount === 1 ? 'prova' : 'provas'}</span>
            <span className="text-content-muted">{course.appliedCount} aplicada{course.appliedCount === 1 ? '' : 's'}</span>
          </div>
          {course.courseState === 'PROVISIONED' && (
            <span className="mt-2 inline-block rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Pendente de ativação</span>
          )}
        </Link>
      ))}
    </div>
  )
}
