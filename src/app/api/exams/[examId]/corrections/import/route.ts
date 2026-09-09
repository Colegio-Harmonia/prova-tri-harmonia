import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { examCorrections } from '@/db/schema'
import { auth } from '@/auth/auth'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { buildEmptyAnswers } from '@/lib/corrections/buildEmptyAnswers'
import { loadExamAndAuthorize, CORRECTABLE_STATUSES } from '@/lib/corrections/authorize'
import { listStudentsInCourse, isInsufficientScopeError } from '@/lib/classroom/classroomClient'

// Importa o roster inteiro da turma vinculada à prova de uma vez, em vez
// de cadastrar aluno por aluno — idempotente: alunos já importados antes
// (mesmo classroomStudentId) são pulados, não duplicados.
export async function POST(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const result = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in result) return result.error
  const { currentUser, exam } = result

  if (!CORRECTABLE_STATUSES.includes(exam.status)) {
    return NextResponse.json({ error: 'Só é possível corrigir uma prova depois que ela foi aplicada.' }, { status: 409 })
  }
  if (!exam.classroomCourseId) {
    return NextResponse.json({ error: 'Vincule uma turma do Classroom antes de importar os alunos.' }, { status: 409 })
  }
  if (session.googleError === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'reauth_required', message: 'Sua conexão com o Google expirou, entre novamente.' }, { status: 401 })
  }
  if (!session.googleAccessToken) {
    return NextResponse.json({ error: 'google_not_connected', message: 'Entre com sua conta Google pra importar o roster.' }, { status: 401 })
  }

  let roster
  try {
    roster = await listStudentsInCourse(session.googleAccessToken, exam.classroomCourseId)
  } catch (err) {
    if (isInsufficientScopeError(err)) {
      return NextResponse.json(
        { error: 'reauth_required', message: 'Sua conta Google precisa autorizar acesso à lista de alunos de novo — entre com o Google outra vez.' },
        { status: 401 },
      )
    }
    console.error('[corrections/import] falha ao buscar roster:', err)
    return NextResponse.json({ error: 'classroom_api_error', message: 'Não consegui buscar a lista de alunos no Google Classroom.' }, { status: 502 })
  }

  const existing = await db.query.examCorrections.findMany({ where: eq(examCorrections.examId, examId) })
  const existingIds = new Set(existing.map((c) => c.classroomStudentId).filter(Boolean))

  const toImport = roster.filter((s) => !existingIds.has(s.classroomStudentId))
  if (toImport.length === 0) {
    return NextResponse.json({ imported: 0, corrections: existing })
  }

  const payload = exam.generationPayload as ExamGenerationResult
  const answers = buildEmptyAnswers(payload)

  await db.insert(examCorrections).values(
    toImport.map((s) => ({
      examId,
      classroomStudentId: s.classroomStudentId,
      studentName: s.name,
      studentEmail: s.email,
      answers,
      createdBy: currentUser.id,
    })),
  )

  const corrections = await db.query.examCorrections.findMany({
    where: eq(examCorrections.examId, examId),
    orderBy: (t, { asc }) => [asc(t.studentName)],
  })

  return NextResponse.json({ imported: toImport.length, corrections })
}
