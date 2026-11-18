import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import type { Session } from 'next-auth'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { isInsufficientScopeError, listStudentsInCourse } from '@/lib/classroom/classroomClient'
import { RecoveryError } from './recoveryService'

export async function recoveryViewer() {
  const session: Session | null = await auth()
  if (!session?.user?.email) return { error: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }) } as const
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email), columns: { id: true, role: true, active: true } })
  if (!user?.active) return { error: NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 401 }) } as const
  return { viewer: { id: user.id, role: user.role }, session } as const
}

export function recoveryErrorResponse(error: unknown, context: string) {
  if (error instanceof RecoveryError) return NextResponse.json({ error: error.message }, { status: error.status })
  if (isInsufficientScopeError(error)) return NextResponse.json({ error: 'reauth_required', message: 'Sua conta Google precisa autorizar de novo — entre com o Google outra vez.' }, { status: 401 })
  console.error(`[recovery] ${context}:`, error)
  return NextResponse.json({ error: 'Não foi possível concluir a operação de recuperação.' }, { status: 500 })
}

/** Roster vindo do Classroom (nunca do cliente): nome e e-mail são a fonte oficial. */
export async function classroomRoster(session: Session | null, courseId: string) {
  if (session?.googleError === 'RefreshAccessTokenError') throw new RecoveryError('Sua conexão com o Google expirou, entre novamente.', 401)
  if (!session?.googleAccessToken) throw new RecoveryError('Entre com sua conta Google para ler os alunos da turma no Classroom.', 401)
  return listStudentsInCourse(session.googleAccessToken, courseId)
}

export function parseId(value: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new RecoveryError('Identificador inválido.', 400)
  return id
}
