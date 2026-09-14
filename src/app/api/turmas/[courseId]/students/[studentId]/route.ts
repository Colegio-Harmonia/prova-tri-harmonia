import { NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examCorrections, generatedExams, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { isInsufficientScopeError, listMyCourses, listStudentsInCourse } from '@/lib/classroom/classroomClient'
import { totalGrade } from '@/lib/corrections/totalGrade'
import type { CorrectionAnswer } from '@/types/correction'

export async function GET(_request: Request, { params }: { params: Promise<{ courseId: string; studentId: string }> }) {
  const { courseId, studentId } = await params
  const session = await auth()
  if (!session?.user?.email || !session.googleAccessToken) return NextResponse.json({ error: 'google_not_connected' }, { status: 401 })
  try {
    const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email), columns: { id: true, role: true } })
    if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })
    const [courses, students] = await Promise.all([listMyCourses(session.googleAccessToken), listStudentsInCourse(session.googleAccessToken, courseId)])
    const course = courses.find((item) => item.id === courseId)
    const student = students.find((item) => item.classroomStudentId === studentId)
    if (!course || !student) return NextResponse.json({ error: 'Aluno ou turma não encontrado.' }, { status: 404 })
    const exams = await db.select({ id: generatedExams.id, subject: generatedExams.subject, gradeYear: generatedExams.gradeYear, bimester: generatedExams.bimester, status: generatedExams.status, createdAt: generatedExams.createdAt, appliedAt: generatedExams.appliedAt })
      .from(generatedExams).where(and(eq(generatedExams.examKind, 'prova'), eq(generatedExams.classroomCourseId, courseId), ...(!isStaffSuperuser(currentUser.role) ? [eq(generatedExams.assignedTo, currentUser.id)] : [])))
    const corrections = exams.length ? await db.select({ examId: examCorrections.examId, status: examCorrections.status, answers: examCorrections.answers, updatedAt: examCorrections.updatedAt })
      .from(examCorrections).where(and(inArray(examCorrections.examId, exams.map((exam) => exam.id)), eq(examCorrections.classroomStudentId, studentId))) : []
    const byExam = new Map(corrections.map((correction) => [correction.examId, correction]))
    const deliveredExams = exams.map((exam) => {
      const correction = byExam.get(exam.id)
      const answers = (correction?.answers ?? []) as CorrectionAnswer[]
      const answered = answers.filter((answer) => answer.transcribedAnswer?.trim()).length
      return { ...exam, correctionStatus: correction?.status ?? 'não entregue', grade: correction?.status === 'revisado' ? totalGrade(answers) : null, answered, totalQuestions: answers.length, correctedAt: correction?.updatedAt ?? null }
    })
    const graded = deliveredExams.filter((exam) => exam.grade !== null)
    const averageGrade = graded.length ? Math.round((graded.reduce((sum, exam) => sum + (exam.grade ?? 0), 0) / graded.length) * 10) / 10 : null
    return NextResponse.json({ course, student, exams: deliveredExams, statistics: { exams: deliveredExams.length, graded: graded.length, averageGrade, delivered: deliveredExams.filter((exam) => exam.correctionStatus !== 'não entregue').length } })
  } catch (err) {
    if (isInsufficientScopeError(err)) return NextResponse.json({ error: 'reauth_required', message: 'Sua conta Google precisa autorizar de novo.' }, { status: 401 })
    console.error('[api/turmas/student] falha ao carregar aluno:', err)
    return NextResponse.json({ error: 'classroom_api_error', message: 'Não consegui carregar os dados do aluno.' }, { status: 502 })
  }
}
