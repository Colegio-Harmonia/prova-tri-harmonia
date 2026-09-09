import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'

export async function getCurrentApiUser() {
  const session = await auth()
  if (!session?.user?.email) {
    return { user: null, response: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  }

  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!user || !user.active) {
    return { user: null, response: NextResponse.json({ error: 'Usuário não encontrado ou inativo' }, { status: 401 }) }
  }

  return { user, response: null }
}

export function parseRouteId(value: string | undefined, label = 'ID') {
  const id = Number(value)
  if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
    return { id: null, response: NextResponse.json({ error: `${label} inválido` }, { status: 400 }) }
  }

  return { id, response: null }
}

export function handlePedagogicalApiError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Erro interno no motor pedagógico.'
  const status = /nao encontrada|não encontrada|not found/i.test(message) ? 404 : 400
  return NextResponse.json({ error: message }, { status })
}
