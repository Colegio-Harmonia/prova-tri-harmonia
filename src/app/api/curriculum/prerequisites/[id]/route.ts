import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { PREREQUISITE_STRENGTHS, users } from '@/db/schema'
import { PrerequisiteError, reviewPrerequisite } from '@/lib/curriculum/prerequisiteService'

const bodySchema = z.object({
  status: z.enum(['aprovada', 'rejeitada']),
  strength: z.enum(PREREQUISITE_STRENGTHS).optional(),
  note: z.string().max(400).nullable().optional(),
})

// Revisão de um pré-requisito: só coordenação/direção (checado no serviço).
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!user?.active) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 401 })
  const id = Number((await props.params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Identificador inválido.' }, { status: 400 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  try {
    return NextResponse.json({ prerequisite: await reviewPrerequisite({ viewer: user, id, ...parsed.data }) })
  } catch (error) {
    if (error instanceof PrerequisiteError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
