'use client'

import { useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'

// Botão "Publicar no Google Classroom" (Módulo 3) — só aparece pra
// atividade de reforço aprovada. Publica uma vez (idempotente no
// servidor); republicar devolve o link da atividade já criada.

type ClassroomCourse = { id: string; name: string; section: string | null }

const publishStageMessage: Record<string, string> = {
  verify_course_teacher: 'verificar se sua conta é professora da turma',
  create_form: 'criar o Formulário Google',
  share_form_with_teacher: 'liberar a edição do Formulário à professora responsável',
  export_pdf: 'preparar o PDF da atividade',
  create_coursework: 'criar a atividade na turma',
  publish_coursework: 'publicar a atividade criada',
  persist_sync: 'registrar a publicação no ProvaTRI',
}

function classroomPublishError(data: { stage?: unknown; provider?: { httpStatus?: unknown; googleStatus?: unknown; reason?: unknown } }) {
  const stage = typeof data.stage === 'string' ? publishStageMessage[data.stage] : null
  if (!stage) return 'O Google Classroom recusou a publicação. Tente reconectar sua conta Google.'
  const status = typeof data.provider?.httpStatus === 'number' ? ` (${data.provider.httpStatus})` : ''
  const reason = typeof data.provider?.reason === 'string' ? ` — ${data.provider.reason}` : ''
  const guidance = data.provider?.reason === 'PERMISSION_DENIED' && data.stage === 'create_rubric'
    ? ' Confirme que quem publica e a proprietária da turma possuem Education Plus e são professoras da turma.'
    : data.provider?.reason === 'SERVICE_DISABLED' && data.stage === 'share_form_with_teacher'
      ? ' Ative a Google Drive API no projeto do Google Cloud e tente novamente.'
    : data.provider?.reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'
      ? ' Reconecte sua conta Google para renovar as permissões.'
      : ''
  return `O Classroom recusou ao ${stage}${status}${reason}.${guidance}`
}

export default function PublishToClassroom({
  examId,
  linkedCourseId,
  alreadyPublished,
  formEditUrl,
  activityKind,
}: {
  examId: number
  linkedCourseId: string | null
  alreadyPublished: boolean
  formEditUrl: string | null
  activityKind: 'prova' | 'reforco_enem' | 'atividade'
}) {
  const [courses, setCourses] = useState<ClassroomCourse[]>([])
  const [courseId, setCourseId] = useState(linkedCourseId ?? '')
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsGoogle, setNeedsGoogle] = useState(false)
  const [published, setPublished] = useState<{ link: string | null; formEditUrl: string | null; existing: boolean; draft: boolean } | null>(alreadyPublished ? { link: null, formEditUrl, existing: true, draft: false } : null)

  useEffect(() => {
    if (linkedCourseId) return
    fetch('/api/classroom/courses')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => setCourses(data.courses ?? []))
      .catch(() => setNeedsGoogle(true))
  }, [linkedCourseId])

  async function publish() {
    setPublishing(true)
    setError(null)
    try {
      const res = await fetch(`/api/exams/${examId}/publish-classroom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(courseId ? { courseId } : {}),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === 'google_not_connected' || data.error === 'reauth_required') {
          setNeedsGoogle(true)
          throw new Error(data.stage === 'share_form_with_teacher'
            ? 'Reconecte sua conta Google para permitir que o Formulário seja compartilhado com a professora responsável.'
            : 'Conecte sua conta Google pra publicar no Classroom.')
        }
        if (data.error === 'classroom_not_course_teacher') throw new Error('Sua conta Google não é professora desta turma. Entre no Classroom com a conta certa ou peça à proprietária da turma para adicioná-la como professora.')
        if (data.error === 'classroom_publish_failed') throw new Error(classroomPublishError(data))
        throw new Error(data.error ?? 'Erro ao publicar.')
      }
      setPublished({ link: data.alternateLink ?? null, formEditUrl: data.formEditUrl ?? null, existing: data.alreadyPublished, draft: data.state === 'DRAFT' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao publicar.')
    } finally {
      setPublishing(false)
    }
  }

  if (published) {
    return (
      <span className="inline-flex items-center gap-2 rounded border border-harmonia-green/40 bg-harmonia-green/5 px-3 py-2 text-sm text-harmonia-green">
        ✅ {published.existing ? 'Já publicada no Classroom' : published.draft ? 'Rascunho com Formulário criado no Classroom' : 'Publicada no Classroom'}
        {published.link && (
          <a href={published.link} target="_blank" rel="noreferrer" className="font-medium underline">abrir no Classroom</a>
        )}
        {published.formEditUrl && <a href={published.formEditUrl} target="_blank" rel="noreferrer" className="font-medium underline">editar formulário</a>}
      </span>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {!linkedCourseId && !needsGoogle && (
        <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className="min-h-10 rounded border border-neutral-300 px-2 py-1.5 text-sm">
          <option value="">Turma do Classroom…</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.section ? ` — ${c.section}` : ''}</option>
          ))}
        </select>
      )}
      {needsGoogle ? (
        <button
          type="button"
          onClick={() => signIn('google', { callbackUrl: `/gerar/${examId}/revisar` })}
          className="rounded border border-harmonia-green px-4 py-2 text-sm font-medium text-harmonia-green"
        >
          Conectar Google pra publicar
        </button>
      ) : (
        <button
          type="button"
          onClick={publish}
          disabled={publishing || (!linkedCourseId && !courseId)}
          className="rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {publishing ? 'Criando…' : activityKind === 'atividade' ? 'Criar rascunho com Formulário' : 'Publicar no Google Classroom'}
        </button>
      )}
      {error && <span role="alert" className="text-xs text-red-600">{error}</span>}
    </span>
  )
}
