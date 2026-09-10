import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'

async function resolveArchiveAccess(params: Promise<{ examId: string }>) {
  const session = await auth()
  if (!session?.user?.email) return { error: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) } as const

  const { examId: rawExamId } = await params
  const examId = Number(rawExamId)
  if (!Number.isFinite(examId)) return { error: NextResponse.json({ error: 'ID inválido' }, { status: 400 }) } as const

  const access = await authorizeExamAccess(examId, session.user.email)
  if ('error' in access) return { error: access.error } as const
  return { examId, currentUser: access.currentUser } as const
}

/** Arquiva a prova para todos os usuários que têm acesso a ela. */
export async function POST(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const access = await resolveArchiveAccess(props.params)
  if ('error' in access) return access.error

  await db.update(generatedExams).set({ archivedAt: new Date() }).where(eq(generatedExams.id, access.examId))

  return NextResponse.json({ ok: true, archived: true })
}

/** Restaura a prova para todos os usuários que têm acesso a ela. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const access = await resolveArchiveAccess(props.params)
  if ('error' in access) return access.error

  await db.update(generatedExams).set({ archivedAt: null }).where(eq(generatedExams.id, access.examId))

  return NextResponse.json({ ok: true, archived: false })
}
