import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams, users } from '@/db/schema'
import { auth } from '@/auth/auth'
import { isStaffSuperuser } from '@/lib/auth/roles'

const bodySchema = z.object({ classroomCourseId: z.string().min(1) })

export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
  if (!exam) return NextResponse.json({ error: 'Prova não encontrada' }, { status: 404 })

  const isCoordenacao = isStaffSuperuser(currentUser.role)
  if (!isCoordenacao && exam.assignedTo !== currentUser.id) {
    return NextResponse.json({ error: 'Você não tem permissão pra vincular turma a essa prova.' }, { status: 403 })
  }

  const [updated] = await db
    .update(generatedExams)
    .set({ classroomCourseId: parsed.data.classroomCourseId })
    .where(eq(generatedExams.id, examId))
    .returning()

  return NextResponse.json({ exam: updated })
}
