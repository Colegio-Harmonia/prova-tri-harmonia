'use client'

import { signIn } from 'next-auth/react'
import { useEffect, useMemo, useState } from 'react'
import { downloadSheetAssignments } from './downloadSheetAssignments'

type ClassroomCourse = { id: string; name: string; section: string | null }
type Assignment = {
  id: number
  studentNameSnapshot: string
  status: 'pronta' | 'emitida' | 'cancelada'
  pageCount: number
  emittedAt: string | null
}

type GoogleErrorKind = 'google_not_connected' | 'reauth_required' | null

function errorMessage(body: { error?: string; message?: string }) {
  return body.message ?? body.error ?? 'Não foi possível concluir esta etapa.'
}

export default function SheetAssignmentsPanel({
  examId,
  classroomCourseId,
  onCourseLinked,
}: {
  examId: number
  classroomCourseId: string | null
  onCourseLinked: () => Promise<void>
}) {
  const [courses, setCourses] = useState<ClassroomCourse[]>([])
  const [assignments, setAssignments] = useState<Assignment[] | null>(null)
  const [selectedCourse, setSelectedCourse] = useState('')
  const [googleError, setGoogleError] = useState<GoogleErrorKind>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const [snapshotting, setSnapshotting] = useState(false)
  const [emitting, setEmitting] = useState(false)

  const linkedCourse = useMemo(
    () => courses.find((course) => course.id === classroomCourseId),
    [classroomCourseId, courses],
  )
  const readyAssignments = assignments?.filter((assignment) => assignment.status === 'pronta') ?? []
  const emittedAssignments = assignments?.filter((assignment) => assignment.status === 'emitida') ?? []

  async function loadCourses() {
    const response = await fetch('/api/classroom/courses')
    const body = await response.json()
    if (!response.ok) {
      if (body.error === 'google_not_connected' || body.error === 'reauth_required') setGoogleError(body.error)
      return
    }
    setGoogleError(null)
    setCourses(body.courses ?? [])
  }

  async function loadAssignments() {
    const response = await fetch(`/api/exams/${examId}/sheet-assignments/snapshot`)
    const body = await response.json()
    if (!response.ok) throw new Error(errorMessage(body))
    setAssignments(body.assignments ?? [])
  }

  useEffect(() => {
    loadCourses().catch(() => {})
    if (classroomCourseId) loadAssignments().catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as fichas.'))
    else setAssignments(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId, classroomCourseId])

  async function linkCourse() {
    if (!selectedCourse) return
    setLinking(true); setError(null); setNotice(null)
    try {
      const response = await fetch(`/api/exams/${examId}/link-course`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroomCourseId: selectedCourse }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(errorMessage(body))
      await onCourseLinked()
      setNotice('Turma vinculada. Agora congele a lista de alunos para preparar as fichas individuais.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível vincular a turma.')
    } finally {
      setLinking(false)
    }
  }

  async function snapshotRoster() {
    setSnapshotting(true); setError(null); setNotice(null)
    try {
      const response = await fetch(`/api/exams/${examId}/sheet-assignments/snapshot`, { method: 'POST' })
      const body = await response.json()
      if (!response.ok) {
        if (body.error === 'google_not_connected' || body.error === 'reauth_required') setGoogleError(body.error)
        throw new Error(errorMessage(body))
      }
      setAssignments(body.assignments ?? [])
      setNotice(`${body.created ?? 0} ${body.created === 1 ? 'ficha foi preparada' : 'fichas foram preparadas'} para emissão.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível congelar a lista de alunos.')
    } finally {
      setSnapshotting(false)
    }
  }

  async function emitSheets() {
    setEmitting(true); setError(null); setNotice(null)
    try {
      await downloadSheetAssignments(examId, readyAssignments.map((assignment) => assignment.id))
      await loadAssignments()
      setNotice('ZIP baixado. Imprima em escala 100% e entregue a folha individual ao aluno correspondente.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível emitir as fichas.')
    } finally {
      setEmitting(false)
    }
  }

  async function downloadEmittedSheets() {
    setEmitting(true); setError(null); setNotice(null)
    try {
      await downloadSheetAssignments(examId, emittedAssignments.map((assignment) => assignment.id), 'download')
      setNotice('ZIP dos cartões já emitidos foi baixado. Imprima em escala 100%.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível baixar os cartões emitidos.')
    } finally {
      setEmitting(false)
    }
  }

  return (
    <section className="rounded-lg border border-harmonia-green/30 bg-harmonia-green/5 p-4" aria-labelledby="sheet-assignments-title">
      <h2 id="sheet-assignments-title" className="font-semibold text-harmonia-green">Folhas de resposta</h2>
      <p className="mt-1 text-sm text-neutral-600">Vincule a turma, congele a lista de alunos e baixe fichas individuais com QR antes da impressão da prova.</p>

      {googleError && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>{googleError === 'reauth_required' ? 'Sua conexão com o Google expirou.' : 'Conecte sua conta Google para acessar as turmas e alunos do Classroom.'}</p>
          <button type="button" onClick={() => signIn('google', { callbackUrl: `/gerar/${examId}/revisar` })} className="mt-2 rounded bg-harmonia-green px-3 py-1.5 text-sm font-medium text-white">
            {googleError === 'reauth_required' ? 'Entrar novamente com Google' : 'Conectar Google'}
          </button>
        </div>
      )}

      {!classroomCourseId ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded border bg-white p-3">
          <div className="space-y-1">
            <label htmlFor="sheet-classroom-course" className="text-sm font-medium">Turma do Classroom</label>
            <select id="sheet-classroom-course" value={selectedCourse} onChange={(event) => setSelectedCourse(event.target.value)} className="block rounded border border-neutral-300 px-2 py-2 text-sm">
              <option value="">Selecione…</option>
              {courses.map((course) => <option key={course.id} value={course.id}>{course.name}{course.section ? ` — ${course.section}` : ''}</option>)}
            </select>
          </div>
          <button type="button" onClick={linkCourse} disabled={!selectedCourse || linking} className="rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
            {linking ? 'Vinculando…' : 'Vincular turma'}
          </button>
        </div>
      ) : (
        <div className="mt-3 rounded border bg-white p-3 text-sm">
          <p><strong>Turma vinculada:</strong> {linkedCourse ? `${linkedCourse.name}${linkedCourse.section ? ` — ${linkedCourse.section}` : ''}` : 'turma do Classroom'}</p>
          {assignments === null ? <p className="mt-2 text-neutral-500">Carregando fichas…</p> : <>
            <p className="mt-2 text-neutral-600">{assignments.length === 0 ? 'Nenhuma ficha preparada ainda.' : `${assignments.length} fichas no lote: ${readyAssignments.length} prontas e ${emittedAssignments.length} já emitidas.`}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={snapshotRoster} disabled={snapshotting} className="rounded border border-harmonia-green px-4 py-2 text-sm font-medium text-harmonia-green disabled:opacity-60">
                {snapshotting ? 'Congelando alunos…' : assignments.length === 0 ? 'Preparar fichas da turma' : 'Atualizar lista antes da impressão'}
              </button>
              {readyAssignments.length > 0 && <button type="button" onClick={emitSheets} disabled={emitting} className="rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                {emitting ? 'Gerando ZIP…' : `Baixar ${readyAssignments.length} ${readyAssignments.length === 1 ? 'ficha' : 'fichas'} em ZIP`}
              </button>}
              {emittedAssignments.length > 0 && <button type="button" onClick={downloadEmittedSheets} disabled={emitting} className="rounded border border-harmonia-green px-4 py-2 text-sm font-medium text-harmonia-green disabled:opacity-60">
                {emitting ? 'Gerando ZIP…' : `Baixar ${emittedAssignments.length} ${emittedAssignments.length === 1 ? 'cartão emitido' : 'cartões emitidos'} em ZIP`}
              </button>}
            </div>
            {assignments.length > 0 && <ul className="mt-3 max-h-36 space-y-1 overflow-y-auto text-xs text-neutral-600">{assignments.map((assignment) => <li key={assignment.id}>{assignment.studentNameSnapshot} · {assignment.pageCount} {assignment.pageCount === 1 ? 'página' : 'páginas'} · {assignment.status === 'emitida' ? 'emitida' : 'pronta para emissão'}</li>)}</ul>}
          </>}
        </div>
      )}

      {error && <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    </section>
  )
}
