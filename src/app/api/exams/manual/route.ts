import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { generatedExams, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { assembleManualExam, manualExamSchema } from '@/lib/exams/manualExam'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!user) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })
  const parsed = manualExamSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Revise os dados da prova.', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const assignedTo = isStaffSuperuser(user.role) ? input.assignedTo : user.id
  if (!assignedTo) return NextResponse.json({ error: 'Selecione o professor responsável.' }, { status: 422 })
  const assignee = await db.query.users.findFirst({ where: eq(users.id, assignedTo) })
  if (!assignee?.active || assignee.role !== 'professor') return NextResponse.json({ error: 'Selecione um professor ativo.' }, { status: 422 })
  const payload = assembleManualExam({ ...input, questionCount: 0, objectiveCount: 0, discursiveCount: 0, alternativesCount: 0 }, [])
  const [exam] = await db.insert(generatedExams).values({
    createdBy: user.id, assignedTo, assignedBy: user.id, assignedAt: new Date(),
    segment: input.segment, gradeYear: input.gradeYear, subject: input.subject, academicYear: input.academicYear, bimester: input.bimester,
    status: 'rascunho', questionCount: 0, objectiveCount: 0, discursiveCount: 0, generationPayload: payload,
  }).returning({ id: generatedExams.id })
  return NextResponse.json({ examId: exam.id }, { status: 201 })
}
