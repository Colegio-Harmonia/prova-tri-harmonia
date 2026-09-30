import { and, desc, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { pedagogicalInterventions, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'

async function currentManager() {
  const session = await auth()
  if (!session?.user?.email) return null
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  return user && isStaffSuperuser(user.role) ? user : null
}

export async function GET(req: NextRequest) {
  const user = await currentManager()
  if (!user) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const yearParam = req.nextUrl.searchParams.get('academicYear')
  const year = yearParam ? Number(yearParam) : null
  const rows = await db.select().from(pedagogicalInterventions)
    .where(year !== null && Number.isInteger(year) ? eq(pedagogicalInterventions.academicYear, year) : undefined)
    .orderBy(desc(pedagogicalInterventions.createdAt))
  return NextResponse.json({ interventions: rows })
}

export async function POST(req: NextRequest) {
  const user = await currentManager()
  if (!user) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const body = await req.json()
  const gradeYear = Number(body.gradeYear)
  if (!body.segment || !Number.isInteger(gradeYear) || !body.subject?.trim() || !body.action?.trim() || !body.ownerName?.trim()) {
    return NextResponse.json({ error: 'Preencha grupo, ação e responsável.' }, { status: 400 })
  }
  const academicYear = Number(body.academicYear)
  const [created] = await db.insert(pedagogicalInterventions).values({
    segment: body.segment, gradeYear, subject: body.subject.trim(),
    academicYear: Number.isInteger(academicYear) && academicYear >= 2000 && academicYear <= 2100 ? academicYear : null,
    action: body.action.trim(), ownerName: body.ownerName.trim(), dueDate: body.dueDate || null, createdBy: user.id,
  }).returning()
  return NextResponse.json({ intervention: created }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const user = await currentManager()
  if (!user) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const body = await req.json()
  const id = Number(body.id)
  if (!Number.isInteger(id) || !['planejada', 'em_andamento', 'concluida'].includes(body.status)) return NextResponse.json({ error: 'Atualização inválida.' }, { status: 400 })
  const [updated] = await db.update(pedagogicalInterventions).set({ status: body.status, updatedAt: new Date() }).where(and(eq(pedagogicalInterventions.id, id))).returning()
  return NextResponse.json({ intervention: updated })
}
