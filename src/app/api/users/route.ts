import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { administrativeAudit, googleChatInstallations, users } from '@/db/schema'
import { auth } from '@/auth/auth'
import { isStaffSuperuser } from '@/lib/auth/roles'

const INSTITUTIONAL_DOMAIN = 'colegioharmonia.com.br'

// GET sem `all=1`: só ativos (uso existente — dropdowns de atribuição, todo
// usuário logado pode ver). Com `all=1`: todos, ativos e inativos (uso
// novo — tela de gerenciamento, só coordenação/direção).
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const wantsAll = req.nextUrl.searchParams.get('all') === '1'
  if (wantsAll) {
    const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
    if (!currentUser || !isStaffSuperuser(currentUser.role)) {
      return NextResponse.json({ error: 'Só coordenação/direção pode ver todos os usuários.' }, { status: 403 })
    }
    const allUsers = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        active: users.active,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        chatConnectedAt: googleChatInstallations.connectedAt,
      })
      .from(users)
      .leftJoin(googleChatInstallations, and(
        eq(googleChatInstallations.userId, users.id),
        eq(googleChatInstallations.active, true),
      ))
      .orderBy(asc(users.name))
    return NextResponse.json({ users: allUsers })
  }

  const activeUsers = await db.query.users.findMany({
    where: eq(users.active, true),
    columns: { id: true, name: true, email: true, role: true },
  })
  return NextResponse.json({ users: activeUsers })
}

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['professor', 'coordenacao', 'direcao']),
})

// Cadastro exclusivo de e-mail institucional — a conta faz login via Google
// OAuth (sem senha, ver src/auth/auth.ts), consistente com "sem
// autocadastro": só quem já existe aqui consegue entrar com o Google.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser || !isStaffSuperuser(currentUser.role)) {
    return NextResponse.json({ error: 'Só coordenação/direção pode cadastrar usuários.' }, { status: 403 })
  }

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })

  if (!parsed.data.email.toLowerCase().endsWith(`@${INSTITUTIONAL_DOMAIN}`)) {
    return NextResponse.json({ error: `Só e-mails @${INSTITUTIONAL_DOMAIN} podem ser cadastrados.` }, { status: 400 })
  }

  const existing = await db.query.users.findFirst({ where: eq(users.email, parsed.data.email) })
  if (existing) return NextResponse.json({ error: 'Já existe um usuário com esse e-mail.' }, { status: 409 })

  const [created] = await db
    .insert(users)
    .values({ name: parsed.data.name, email: parsed.data.email, role: parsed.data.role })
    .returning({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active })

  await db.insert(administrativeAudit).values({
    action: 'user_created', actorId: currentUser.id, targetUserId: created.id,
    nextValue: { name: created.name, email: created.email, role: created.role, active: created.active },
  })

  return NextResponse.json({ user: created })
}
