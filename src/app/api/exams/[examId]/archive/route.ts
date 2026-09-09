import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examUserArchives } from '@/db/schema'
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

/** Arquiva somente para o usuário autenticado; é idempotente. */
export async function POST(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const access = await resolveArchiveAccess(props.params)
  if ('error' in access) return access.error

  await db
    .insert(examUserArchives)
    .values({ examId: access.examId, userId: access.currentUser.id })
    .onConflictDoNothing({ target: [examUserArchives.userId, examUserArchives.examId] })

  return NextResponse.json({ ok: true, archived: true })
}

/** Restaura a prova somente na visão do usuário autenticado; é idempotente. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const access = await resolveArchiveAccess(props.params)
  if ('error' in access) return access.error

  await db
    .delete(examUserArchives)
    .where(and(eq(examUserArchives.examId, access.examId), eq(examUserArchives.userId, access.currentUser.id)))

  return NextResponse.json({ ok: true, archived: false })
}
