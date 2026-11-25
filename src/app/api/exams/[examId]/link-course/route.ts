import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { examCorrections, generatedExams, users } from '@/db/schema'
import { auth } from '@/auth/auth'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { deleteCourseWork, summarizeClassroomApiError } from '@/lib/classroom/classroomClient'

const bodySchema = z.object({
  classroomCourseId: z.string().min(1),
  // Troca de turma depois que a atividade da prova já existe no Classroom
  // (ex.: prova de Ciências vinculada por engano à turma de Artes). Só vale
  // para prova; a atividade antiga é apagada e as notas voltam a "não
  // lançadas", para serem lançadas de novo na turma certa.
  replaceCourseWork: z.boolean().optional(),
})

export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 })
  const { classroomCourseId, replaceCourseWork } = parsed.data

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
  if (!exam) return NextResponse.json({ error: 'Prova não encontrada' }, { status: 404 })

  const isCoordenacao = isStaffSuperuser(currentUser.role)
  if (!isCoordenacao && exam.assignedTo !== currentUser.id) {
    return NextResponse.json({ error: 'Você não tem permissão pra vincular turma a essa prova.' }, { status: 403 })
  }

  const changesCourseWithActivity = Boolean(exam.classroomCourseWorkId && exam.classroomCourseId && exam.classroomCourseId !== classroomCourseId)
  if (changesCourseWithActivity && !replaceCourseWork) {
    return NextResponse.json({
      error: 'course_work_exists',
      message: 'A atividade desta prova já foi criada no Classroom. Use "Trocar turma" na tela de correção para mudar a turma.',
    }, { status: 409 })
  }

  if (!changesCourseWithActivity) {
    const [updated] = await db
      .update(generatedExams)
      .set({ classroomCourseId })
      .where(eq(generatedExams.id, examId))
      .returning()
    return NextResponse.json({ exam: updated })
  }

  if (exam.examKind !== 'prova') {
    return NextResponse.json({ error: 'A troca de turma com atividade criada só está disponível para provas.' }, { status: 422 })
  }

  // Mesmo lock usado ao criar a atividade em return-grades: impede que um
  // lançamento em andamento grave o id da atividade antiga depois da troca.
  const previous = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${examId})`)
    const current = await tx.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
    if (!current) return null
    const snapshot = { courseId: current.classroomCourseId, courseWorkId: current.classroomCourseWorkId }
    await tx.update(generatedExams)
      .set({ classroomCourseId, classroomCourseWorkId: null })
      .where(eq(generatedExams.id, examId))
    await tx.update(examCorrections)
      .set({ gradeReturnedAt: null })
      .where(eq(examCorrections.examId, examId))
    return snapshot
  })
  if (!previous) return NextResponse.json({ error: 'Prova não encontrada' }, { status: 404 })

  // A atividade antiga só é apagada depois que a prova já aponta para a turma
  // nova: se o Classroom recusar, sobra uma atividade para apagar à mão, mas a
  // prova nunca volta a lançar nota na turma errada.
  let previousCourseWorkDeleted = false
  if (previous.courseId && previous.courseWorkId && session.googleAccessToken && session.googleError !== 'RefreshAccessTokenError') {
    try {
      await deleteCourseWork(session.googleAccessToken, previous.courseId, previous.courseWorkId)
      previousCourseWorkDeleted = true
    } catch (err) {
      const summary = summarizeClassroomApiError(err)
      if (summary.httpStatus === 404 || summary.googleStatus === 'NOT_FOUND') {
        previousCourseWorkDeleted = true // já tinha sido apagada no Classroom
      } else {
        console.warn('[link-course] não consegui apagar a atividade da turma anterior:', summary)
      }
    }
  }

  const updated = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
  return NextResponse.json({
    exam: updated,
    previousCourseWork: { courseId: previous.courseId, courseWorkId: previous.courseWorkId, deleted: previousCourseWorkDeleted },
  })
}
