import { NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examCorrections, generatedExams, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'

export async function GET() {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const currentUser = await db.query.users.findFirst({
    where: eq(users.email, session.user.email),
    columns: { id: true, role: true },
  })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  const conditions = [
    eq(generatedExams.examKind, 'prova'),
    eq(examCorrections.status, 'revisado'),
    eq(examCorrections.attendanceStatus, 'presente'),
  ]
  if (!isStaffSuperuser(currentUser.role)) conditions.push(eq(generatedExams.assignedTo, currentUser.id))

  const rows = await db
    .selectDistinct({
      examId: generatedExams.id,
      segment: generatedExams.segment,
      gradeYear: generatedExams.gradeYear,
      subject: generatedExams.subject,
      academicYear: generatedExams.academicYear,
      bimester: generatedExams.bimester,
      classroomCourseId: generatedExams.classroomCourseId,
      assignedTo: generatedExams.assignedTo,
    })
    .from(generatedExams)
    .innerJoin(examCorrections, eq(examCorrections.examId, generatedExams.id))
    .where(and(...conditions))
    .orderBy(asc(generatedExams.academicYear), asc(generatedExams.bimester), asc(generatedExams.subject))

  return NextResponse.json({
    rows,
    assessments: rows.map((row) => ({
      id: row.examId,
      label: `${row.subject} · ${row.gradeYear}º ano · ${row.academicYear}${row.bimester ? `.${row.bimester}` : ''}`,
    })),
  })
}
