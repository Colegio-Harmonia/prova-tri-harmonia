import { asc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { withViewer } from '@/lib/curriculum/planningRoute'
import { PlanningError } from '@/lib/curriculum/planningService'

// Equipe ativa para atribuir responsáveis (só gestão).
export async function GET() {
  return withViewer(async (viewer) => {
    if (!isStaffSuperuser(viewer.role)) throw new PlanningError('Ação restrita à coordenação e à direção.', 403)
    const staff = await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.active, true)).orderBy(asc(users.name))
    return NextResponse.json({ staff })
  })
}
