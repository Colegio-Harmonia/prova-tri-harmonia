import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { PlanningError, type Viewer } from './planningService'

/** Resolve o usuário logado e traduz erros de domínio em respostas HTTP. */
export async function withViewer(handler: (viewer: Viewer) => Promise<Response>) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!user?.active) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 401 })
  try {
    return await handler({ id: user.id, role: user.role })
  } catch (error) {
    if (error instanceof PlanningError) return NextResponse.json({ error: error.message, details: error.details }, { status: error.status })
    if (error instanceof ZodError) return NextResponse.json({ error: 'Dados inválidos.', details: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) }, { status: 400 })
    console.error('[planejamento] erro inesperado:', error)
    return NextResponse.json({ error: 'Erro inesperado no planejamento.' }, { status: 500 })
  }
}

export function idParam(value: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new PlanningError('Identificador inválido.', 400)
  return id
}
