import { NextRequest, NextResponse } from 'next/server'
import { eq, and, inArray, ne } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams, examCorrections, users } from '@/db/schema'
import { auth } from '@/auth/auth'
import { loadExamAndAuthorize, CORRECTABLE_STATUSES } from '@/lib/corrections/authorize'
import { totalGrade } from '@/lib/corrections/totalGrade'
import type { CorrectionAnswer } from '@/types/correction'
import { createCourseWork, listSubmissions, patchAndReturnGrade, isInsufficientScopeError } from '@/lib/classroom/classroomClient'
import { sendChatGradesReturnedNotification } from '@/lib/notifications/googleChat'

// Cria a atividade (se ainda não existe) e lança + devolve a nota de todo
// aluno já "Revisado" com classroomStudentId — numa chamada só, por
// decisão confirmada com o usuário (sem rascunho intermediário). Aluno
// "Pendente" ou sem vínculo com o roster do Classroom é pulado, nunca
// lançado incompleto/errado.
export async function POST(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const result = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in result) return result.error
  const { exam, currentUser } = result

  if (!CORRECTABLE_STATUSES.includes(exam.status)) {
    return NextResponse.json({ error: 'Só é possível lançar nota depois que a prova foi aplicada.' }, { status: 409 })
  }
  if (!exam.classroomCourseId) {
    return NextResponse.json({ error: 'Vincule uma turma do Classroom antes de lançar notas.' }, { status: 409 })
  }
  if (session.googleError === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'reauth_required', message: 'Sua conexão com o Google expirou, entre novamente.' }, { status: 401 })
  }
  if (!session.googleAccessToken) {
    return NextResponse.json({ error: 'google_not_connected', message: 'Entre com sua conta Google pra lançar notas.' }, { status: 401 })
  }
  const accessToken = session.googleAccessToken

  const allCorrections = await db.query.examCorrections.findMany({ where: eq(examCorrections.examId, examId) })

  const skippedPending = allCorrections.filter((c) => c.status !== 'revisado').length
  const skippedNoRoster = allCorrections.filter((c) => c.status === 'revisado' && !c.classroomStudentId).length
  const eligible = allCorrections.filter((c) => {
    if (c.status !== 'revisado' || !c.classroomStudentId) return false
    return totalGrade(c.answers as CorrectionAnswer[]) !== null
  })

  if (eligible.length === 0) {
    return NextResponse.json({ granted: 0, skippedPending, skippedNoRoster, errors: [] })
  }

  try {
    let courseWorkId = exam.classroomCourseWorkId
    if (!courseWorkId) {
      const bimesterLabel = exam.bimester ? ` — ${exam.bimester}º bimestre` : ''
      const created = await createCourseWork(accessToken, exam.classroomCourseId, {
        title: `${exam.subject} — ${exam.gradeYear}º ano${bimesterLabel} (Prova)`,
        description: 'Prova aplicada em papel — nota lançada pela coordenação/professor via Prova-TRI, corrigida fora do Classroom.',
        maxPoints: 10,
      })
      courseWorkId = created.id
      await db.update(generatedExams).set({ classroomCourseWorkId: courseWorkId }).where(eq(generatedExams.id, examId))
    }

    const submissions = await listSubmissions(accessToken, exam.classroomCourseId, courseWorkId)
    const submissionIdByStudent = new Map(submissions.map((s) => [s.userId, s.submissionId]))

    const errors: Array<{ studentName: string; message: string }> = []
    let granted = 0

    for (const correction of eligible) {
      const submissionId = submissionIdByStudent.get(correction.classroomStudentId!)
      if (!submissionId) {
        errors.push({ studentName: correction.studentName, message: 'Aluno não encontrado na atividade do Classroom (pode ter saído da turma).' })
        continue
      }
      const grade = totalGrade(correction.answers as CorrectionAnswer[])!
      try {
        await patchAndReturnGrade(accessToken, exam.classroomCourseId, courseWorkId, submissionId, grade)
        await db.update(examCorrections).set({ gradeReturnedAt: new Date() }).where(eq(examCorrections.id, correction.id))
        granted++
      } catch (err) {
        console.error(`[return-grades] falha ao lançar nota de ${correction.studentName}:`, err)
        errors.push({ studentName: correction.studentName, message: 'Erro ao lançar essa nota específica no Classroom.' })
      }
    }

    // Gatilho 2 (Subtarefa 8): avisa coordenação/direção que o professor
    // terminou — best-effort, nunca derruba a resposta se o Chat falhar.
    // Não notifica a si mesmo (coordenação/direção corrigindo a própria
    // prova não precisa de aviso sobre a própria ação).
    if (granted > 0) {
      const recipients = await db.query.users.findMany({
        where: and(inArray(users.role, ['coordenacao', 'direcao']), eq(users.active, true), ne(users.id, currentUser.id)),
        columns: { email: true },
      })
      if (recipients.length > 0) {
        const bimesterLabel = exam.bimester ? ` — ${exam.bimester}º bimestre` : ''
        const examLabel = `${exam.subject} — ${exam.gradeYear}º ano${bimesterLabel}`
        await sendChatGradesReturnedNotification(recipients.map((r) => r.email), currentUser.name, examLabel)
      }
    }

    return NextResponse.json({ granted, skippedPending, skippedNoRoster, errors })
  } catch (err) {
    if (isInsufficientScopeError(err)) {
      return NextResponse.json(
        { error: 'reauth_required', message: 'Sua conta Google precisa autorizar lançamento de nota de novo — entre com o Google outra vez.' },
        { status: 401 },
      )
    }
    console.error('[return-grades] falha geral:', err)
    return NextResponse.json({ error: 'classroom_api_error', message: 'Não consegui lançar as notas no Google Classroom.' }, { status: 502 })
  }
}
