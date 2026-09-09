import { NextRequest, NextResponse } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { enemSaeImports, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser || !isStaffSuperuser(currentUser.role)) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })

  const academicYear = Number(request.nextUrl.searchParams.get('academicYear') ?? new Date().getFullYear())
  if (!Number.isInteger(academicYear) || academicYear < 2000 || academicYear > 2100) {
    return NextResponse.json({ error: 'Ano letivo inválido.' }, { status: 400 })
  }

  const imports = await db
    .select({ bimester: enemSaeImports.bimester, analysis: enemSaeImports.analysis, updatedAt: enemSaeImports.updatedAt })
    .from(enemSaeImports)
    .where(eq(enemSaeImports.academicYear, academicYear))
    .orderBy(desc(enemSaeImports.bimester))

  return NextResponse.json({ academicYear, imports })
}
