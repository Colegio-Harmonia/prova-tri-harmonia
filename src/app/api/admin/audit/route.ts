import { desc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { administrativeAudit, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'

export async function GET() {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser || !isStaffSuperuser(currentUser.role)) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })

  const actor = alias(users, 'audit_actor')
  const target = alias(users, 'audit_target')
  const events = await db
    .select({
      action: administrativeAudit.action,
      createdAt: administrativeAudit.createdAt,
      targetUserId: administrativeAudit.targetUserId,
      actorName: actor.name,
      targetUserName: target.name,
      previousValue: administrativeAudit.previousValue,
      nextValue: administrativeAudit.nextValue,
    })
    .from(administrativeAudit)
    .leftJoin(actor, eq(administrativeAudit.actorId, actor.id))
    .leftJoin(target, eq(administrativeAudit.targetUserId, target.id))
    .orderBy(desc(administrativeAudit.createdAt))
    .limit(12)
  return NextResponse.json({ events })
}
