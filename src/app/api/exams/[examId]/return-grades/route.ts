import { NextRequest, NextResponse } from 'next/server'
import { eq, and, inArray, ne, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams, examCorrections, users } from '@/db/schema'
import { auth } from '@/auth/auth'
import { loadExamAndAuthorize, CORRECTABLE_STATUSES } from '@/lib/corrections/authorize'
import { totalGrade } from '@/lib/corrections/totalGrade'
import type { CorrectionAnswer } from '@/types/correction'
import { createCourseWork, listSubmissions, patchAndReturnGrade, isInsufficientScopeError, isUnavailableCourseWorkError, summarizeClassroomApiError, updateCourseWorkMaxPoints, updateCourseWorkTitle } from '@/lib/classroom/classroomClient'
import { sendChatGradesReturnedNotification } from '@/lib/notifications/googleChat'
import { getExamCompletionSummary } from '@/lib/corrections/examCompletion'
import { CLASSROOM_MAX_POINTS, gradeOnClassroomScale } from '@/lib/classroom/gradeScale'

function examCourseWorkTitle(bimester: number | null): string {
  return bimester ? `Avaliação ${bimester}º Bimestre` : 'Avaliação'
}

async function createExamCourseWork(params: {
  accessToken: string
  examId: number
  courseId: string
  bimester: number | null
  previousCourseWorkId?: string | null
}): Promise<{ id: string; recreated: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${params.examId})`)
    const current = await tx.query.generatedExams.findFirst({ where: eq(generatedExams.id, params.examId) })
    const currentCourseWorkId = current?.classroomCourseWorkId ?? null

    if (params.previousCourseWorkId && currentCourseWorkId && currentCourseWorkId !== params.previousCourseWorkId) {
      return { id: currentCourseWorkId, recreated: false }
    }
    if (!params.previousCourseWorkId && currentCourseWorkId) {
      return { id: currentCourseWorkId, recreated: false }
    }

    const created = await createCourseWork(params.accessToken, params.courseId, {
      title: examCourseWorkTitle(params.bimester),
      description: 'Prova aplicada em papel — nota lançada pela coordenação/professor via Prova-TRI, corrigida fora do Classroom.',
      maxPoints: CLASSROOM_MAX_POINTS,
    })
    await tx.update(generatedExams).set({ classroomCourseWorkId: created.id }).where(eq(generatedExams.id, params.examId))
    return { id: created.id, recreated: Boolean(params.previousCourseWorkId) }
  })
}

// Cria a atividade (se ainda não existe) e lança + devolve a nota de todo
// aluno já "Revisado" com classroomStudentId — numa chamada só, por
// decisão confirmada com o usuário (sem rascunho intermediário). Aluno
// "Pendente" ou sem vínculo com o roster do Classroom é pulado, nunca
// lançado incompleto/errado.
export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const result = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in result) return result.error
  const { exam, currentUser } = result

  if (exam.examKind !== 'prova') {
    return NextResponse.json({ error: 'O lançamento de notas desta tela só está disponível para provas.' }, { status: 422 })
  }
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
  const requestBody = await req.json().catch(() => ({})) as { correctionIds?: unknown }
  const requestedCorrectionIds = Array.isArray(requestBody.correctionIds)
    ? new Set(requestBody.correctionIds.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0))
    : null

  const completion = await getExamCompletionSummary(examId)
  if (!completion.ready) {
    return NextResponse.json({
      error: 'exam_not_complete',
      message: 'Conclua a correção de todos os alunos ou marque como ausentes antes de lançar as notas.',
      completion,
    }, { status: 409 })
  }
  if (!completion.classroomReady) {
    return NextResponse.json({
      error: 'students_without_classroom_link',
      message: 'Há alunos corrigidos sem vínculo com o Classroom. Importe o roster da turma antes de lançar as notas.',
      completion,
    }, { status: 409 })
  }

  const allCorrections = await db.query.examCorrections.findMany({ where: eq(examCorrections.examId, examId) })
  const expectedIds = new Set(completion.correctionIds)
  const expectedCorrections = allCorrections.filter((correction) => expectedIds.has(correction.id))
  const correctionsToProcess = requestedCorrectionIds
    ? expectedCorrections.filter((correction) => requestedCorrectionIds.has(correction.id))
    : expectedCorrections

  const skippedPending = correctionsToProcess.filter((c) => c.attendanceStatus !== 'ausente' && c.status !== 'revisado').length
  const skippedAbsent = correctionsToProcess.filter((c) => c.attendanceStatus === 'ausente').length
  const skippedNoRoster = correctionsToProcess.filter((c) => c.attendanceStatus !== 'ausente' && c.status === 'revisado' && !c.classroomStudentId).length
  const eligible = correctionsToProcess.filter((c) => {
    if (c.attendanceStatus === 'ausente' || c.status !== 'revisado' || !c.classroomStudentId) return false
    return totalGrade(c.answers as CorrectionAnswer[]) !== null
  })

  if (eligible.length === 0) {
    return NextResponse.json({ granted: 0, skippedPending, skippedAbsent, skippedNoRoster, errors: [] })
  }

  try {
    let courseWorkId = exam.classroomCourseWorkId
    let recreatedCourseWork = false
    if (!courseWorkId) {
      const created = await createExamCourseWork({ accessToken, examId, courseId: exam.classroomCourseId, bimester: exam.bimester })
      courseWorkId = created.id
      recreatedCourseWork = created.recreated
    }

    let submissions
    try {
      await updateCourseWorkMaxPoints(accessToken, exam.classroomCourseId, courseWorkId, CLASSROOM_MAX_POINTS)
      await updateCourseWorkTitle(accessToken, exam.classroomCourseId, courseWorkId, examCourseWorkTitle(exam.bimester))
      submissions = await listSubmissions(accessToken, exam.classroomCourseId, courseWorkId)
    } catch (err) {
      if (!isUnavailableCourseWorkError(err)) throw err
      const created = await createExamCourseWork({ accessToken, examId, courseId: exam.classroomCourseId, bimester: exam.bimester, previousCourseWorkId: courseWorkId })
      courseWorkId = created.id
      recreatedCourseWork = recreatedCourseWork || created.recreated
      await updateCourseWorkMaxPoints(accessToken, exam.classroomCourseId, courseWorkId, CLASSROOM_MAX_POINTS)
      await updateCourseWorkTitle(accessToken, exam.classroomCourseId, courseWorkId, examCourseWorkTitle(exam.bimester))
      submissions = await listSubmissions(accessToken, exam.classroomCourseId, courseWorkId)
    }
    const submissionIdByStudent = new Map(submissions.map((s) => [s.userId, s.submissionId]))

    const errors: Array<{ correctionId: number; studentName: string; message: string }> = []
    let granted = 0

    for (const correction of eligible) {
      const submissionId = submissionIdByStudent.get(correction.classroomStudentId!)
      if (!submissionId) {
        errors.push({ correctionId: correction.id, studentName: correction.studentName, message: 'Aluno não encontrado na atividade do Classroom (pode ter saído da turma).' })
        continue
      }
      const grade = gradeOnClassroomScale(totalGrade(correction.answers as CorrectionAnswer[])!)
      try {
        await patchAndReturnGrade(accessToken, exam.classroomCourseId, courseWorkId, submissionId, grade)
        await db.update(examCorrections).set({ gradeReturnedAt: new Date() }).where(eq(examCorrections.id, correction.id))
        granted++
      } catch (err) {
        console.error(`[return-grades] falha ao lançar nota de ${correction.studentName}:`, err)
        errors.push({ correctionId: correction.id, studentName: correction.studentName, message: 'Erro ao lançar essa nota específica no Classroom.' })
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

    return NextResponse.json({
      granted,
      skippedPending,
      skippedAbsent,
      skippedNoRoster,
      errors,
      recreatedCourseWork,
      message: recreatedCourseWork ? 'A atividade anterior havia sido apagada. Uma nova atividade foi criada e as notas foram atualizadas.' : undefined,
    })
  } catch (err) {
    if (isInsufficientScopeError(err)) {
      return NextResponse.json(
        { error: 'reauth_required', message: 'Sua conta Google precisa autorizar lançamento de nota de novo — entre com o Google outra vez.' },
        { status: 401 },
      )
    }
    console.error('[return-grades] falha geral:', summarizeClassroomApiError(err))
    return NextResponse.json({ error: 'classroom_api_error', message: 'Não consegui lançar as notas no Google Classroom.' }, { status: 502 })
  }
}
