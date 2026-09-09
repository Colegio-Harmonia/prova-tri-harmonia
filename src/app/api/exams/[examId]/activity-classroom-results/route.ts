import { NextRequest, NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { activityClassroomResults, activityClassroomSyncs } from '@/db/schema'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { isInsufficientScopeError, listStudentsInCourse, listSubmissions } from '@/lib/classroom/classroomClient'

async function getActivity(reqExamId: string, email: string) {
  const examId = Number(reqExamId)
  if (!Number.isInteger(examId) || examId <= 0) return { error: NextResponse.json({ error: 'Atividade inválida' }, { status: 400 }) }
  const authz = await authorizeExamAccess(examId, email)
  if ('error' in authz) return { error: authz.error }
  if (authz.exam.examKind !== 'atividade') return { error: NextResponse.json({ error: 'Importação disponível somente para Atividades FI/FII.' }, { status: 422 }) }
  return { examId, exam: authz.exam }
}

export async function GET(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const result = await getActivity((await props.params).examId, session.user.email)
  if ('error' in result) return result.error
  const sync = await db.query.activityClassroomSyncs.findFirst({ where: eq(activityClassroomSyncs.examId, result.examId) })
  const rows = await db.select().from(activityClassroomResults).where(eq(activityClassroomResults.examId, result.examId)).orderBy(asc(activityClassroomResults.studentName))
  return NextResponse.json({ sync: sync ? { lastImportedAt: sync.lastImportedAt, lastImportError: sync.lastImportError, rubricId: sync.rubricId } : null, results: rows })
}

export async function POST(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!session.googleAccessToken) return NextResponse.json({ error: 'google_not_connected' }, { status: 403 })
  const result = await getActivity((await props.params).examId, session.user.email)
  if ('error' in result) return result.error
  const sync = await db.query.activityClassroomSyncs.findFirst({ where: eq(activityClassroomSyncs.examId, result.examId) })
  if (!sync) return NextResponse.json({ error: 'Publique a atividade no Classroom antes de importar as correções.' }, { status: 409 })
  try {
    const [submissions, students] = await Promise.all([listSubmissions(session.googleAccessToken, sync.courseId, sync.courseWorkId), listStudentsInCourse(session.googleAccessToken, sync.courseId)])
    const studentsById = new Map(students.map((student) => [student.classroomStudentId, student]))
    const now = new Date()
    for (const submission of submissions) {
      const student = studentsById.get(submission.userId)
      await db.insert(activityClassroomResults).values({
        examId: result.examId,
        classroomStudentId: submission.userId,
        classroomSubmissionId: submission.submissionId,
        studentName: student?.name ?? '(aluno sem nome disponível)',
        studentEmail: student?.email ?? null,
        submissionState: submission.state,
        assignedGrade: submission.assignedGrade,
        assignedRubricGrades: submission.assignedRubricGrades,
        importedAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({ target: [activityClassroomResults.examId, activityClassroomResults.classroomStudentId], set: {
        classroomSubmissionId: submission.submissionId,
        studentName: student?.name ?? '(aluno sem nome disponível)',
        studentEmail: student?.email ?? null,
        submissionState: submission.state,
        assignedGrade: submission.assignedGrade,
        assignedRubricGrades: submission.assignedRubricGrades,
        importedAt: now,
        updatedAt: now,
      } })
    }
    await db.update(activityClassroomSyncs).set({ lastImportedAt: now, lastImportError: null }).where(eq(activityClassroomSyncs.id, sync.id))
    return NextResponse.json({ imported: submissions.length, graded: submissions.filter((submission) => submission.assignedGrade !== null).length, rubricGraded: submissions.filter((submission) => submission.assignedRubricGrades !== null).length, importedAt: now })
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 2000) : 'Erro ao importar correções do Classroom.'
    await db.update(activityClassroomSyncs).set({ lastImportError: message }).where(eq(activityClassroomSyncs.id, sync.id))
    if (isInsufficientScopeError(err)) return NextResponse.json({ error: 'reauth_required' }, { status: 403 })
    console.error('[activity-classroom-results] erro ao importar:', err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
