import { NextResponse } from 'next/server'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examCorrections, generatedExams, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { isInsufficientScopeError, listMyCourses, listStudentsInCourse } from '@/lib/classroom/classroomClient'
import { totalGrade } from '@/lib/corrections/totalGrade'
import type { CorrectionAnswer } from '@/types/correction'

export async function GET(_request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (session.googleError === 'RefreshAccessTokenError') return NextResponse.json({ error: 'reauth_required', message: 'Sua conexão com o Google expirou, entre novamente.' }, { status: 401 })
  if (!session.googleAccessToken) return NextResponse.json({ error: 'google_not_connected', message: 'Entre com sua conta Google pra ver suas turmas do Classroom.' }, { status: 401 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email), columns: { id: true, role: true } })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  try {
    const courses = await listMyCourses(session.googleAccessToken)
    const course = courses.find((item) => item.id === courseId)
    if (!course) return NextResponse.json({ error: 'Turma não encontrada no seu Google Classroom.' }, { status: 404 })

    const exams = await db
      .select({ id: generatedExams.id, subject: generatedExams.subject, gradeYear: generatedExams.gradeYear, bimester: generatedExams.bimester, status: generatedExams.status, createdAt: generatedExams.createdAt, appliedAt: generatedExams.appliedAt, correctedAt: generatedExams.correctedAt })
      .from(generatedExams)
      .where(and(
        eq(generatedExams.examKind, 'prova'),
        eq(generatedExams.classroomCourseId, courseId),
        ...(!isStaffSuperuser(currentUser.role) ? [eq(generatedExams.assignedTo, currentUser.id)] : []),
      ))
      .orderBy(desc(generatedExams.createdAt))
    if (!exams.length) return NextResponse.json({ error: 'Nenhuma prova vinculada a esta turma.' }, { status: 404 })

    const [students, corrections] = await Promise.all([
      listStudentsInCourse(session.googleAccessToken, courseId),
      db.select({ examId: examCorrections.examId, classroomStudentId: examCorrections.classroomStudentId, status: examCorrections.status, answers: examCorrections.answers })
        .from(examCorrections)
        .where(inArray(examCorrections.examId, exams.map((exam) => exam.id))),
    ])

    const byStudent = new Map<string, { corrected: number; grades: number[] }>()
    for (const correction of corrections) {
      if (!correction.classroomStudentId || correction.status !== 'revisado') continue
      const item = byStudent.get(correction.classroomStudentId) ?? { corrected: 0, grades: [] }
      item.corrected += 1
      const grade = totalGrade(correction.answers as CorrectionAnswer[])
      if (grade !== null) item.grades.push(grade)
      byStudent.set(correction.classroomStudentId, item)
    }
    const studentsWithPerformance = students.map((student) => {
      const performance = byStudent.get(student.classroomStudentId) ?? { corrected: 0, grades: [] }
      const averageGrade = performance.grades.length
        ? Math.round((performance.grades.reduce((sum, grade) => sum + grade, 0) / performance.grades.length) * 10) / 10
        : null
      return { ...student, corrected: performance.corrected, averageGrade }
    })
    const allGrades = studentsWithPerformance.flatMap((student) => student.averageGrade === null ? [] : [student.averageGrade])
    const averageGrade = allGrades.length ? Math.round((allGrades.reduce((sum, grade) => sum + grade, 0) / allGrades.length) * 10) / 10 : null

    return NextResponse.json({
      course,
      exams,
      students: studentsWithPerformance,
      performance: { studentCount: students.length, correctedStudents: studentsWithPerformance.filter((student) => student.corrected > 0).length, averageGrade },
    })
  } catch (err) {
    if (isInsufficientScopeError(err)) return NextResponse.json({ error: 'reauth_required', message: 'Sua conta Google precisa autorizar de novo — entre com o Google outra vez.' }, { status: 401 })
    console.error('[api/turmas/[courseId]] falha ao carregar turma:', err)
    return NextResponse.json({ error: 'classroom_api_error', message: 'Não consegui carregar os dados desta turma.' }, { status: 502 })
  }
}
