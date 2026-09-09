import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { activityClassroomSyncs, users } from '@/db/schema'
import { auth } from '@/auth/auth'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { activityFormEditUrl } from '@/lib/forms/activityForm'

export async function GET(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const result = await authorizeExamAccess(examId, session.user.email)
  if ('error' in result) return result.error
  const { exam } = result

  const assignee = exam.assignedTo
    ? await db.query.users.findFirst({ where: eq(users.id, exam.assignedTo), columns: { name: true, email: true } })
    : null
  const sync = exam.examKind === 'atividade'
    ? await db.query.activityClassroomSyncs.findFirst({ where: eq(activityClassroomSyncs.examId, exam.id), columns: { formId: true } })
    : null

  return NextResponse.json({
    exam: {
      ...exam,
      assigneeName: assignee?.name ?? null,
      assigneeEmail: assignee?.email ?? null,
      formEditUrl: sync?.formId ? activityFormEditUrl(sync.formId) : null,
    },
  })
}
