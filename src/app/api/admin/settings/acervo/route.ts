import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { acervoUrlSchema } from '@/lib/settings/acervoUrl'
import { getAcervoApiUrl, saveAcervoApiUrl } from '@/lib/settings/acervoSettings'

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.email) return null
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  return user?.active && isStaffSuperuser(user.role) ? user : null
}

export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  return NextResponse.json({ url: await getAcervoApiUrl() }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const parsed = z.object({ url: acervoUrlSchema }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Endereço inválido.' }, { status: 400 })
  return NextResponse.json({ url: await saveAcervoApiUrl(parsed.data.url, admin.id) })
}
