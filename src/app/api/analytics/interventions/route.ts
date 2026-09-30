import { and, desc, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { pedagogicalInterventions, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { recordDecision } from '@/lib/curriculum/decisionLog'
import { findPlanForScope } from '@/lib/curriculum/operationsData'
import { BNCC_CODE_PATTERN } from '@/lib/curriculum/planningPolicy'

async function currentManager() {
  const session = await auth()
  if (!session?.user?.email) return null
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  return user && isStaffSuperuser(user.role) ? user : null
}

/** Planejamento ligado à intervenção (quando há recorte com bimestre), para o histórico de decisões. */
async function planIdFor(row: typeof pedagogicalInterventions.$inferSelect) {
  if (!row.academicYear || !row.bimester) return null
  return (await findPlanForScope({ academicYear: row.academicYear, segment: row.segment, gradeYear: row.gradeYear, subject: row.subject, bimester: row.bimester }))?.id ?? null
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
  const bimester = Number(body.bimester)
  // Bloco 8.4: habilidades BNCC que a intervenção retoma (opcional).
  const skillCodes = [...new Set((Array.isArray(body.skillCodes) ? body.skillCodes : []).map((code: unknown) => String(code).trim().toUpperCase()).filter(Boolean))] as string[]
  const invalid = skillCodes.filter((code) => !BNCC_CODE_PATTERN.test(code))
  if (invalid.length) return NextResponse.json({ error: `Código(s) BNCC inválido(s): ${invalid.join(', ')}` }, { status: 400 })
  const [created] = await db.insert(pedagogicalInterventions).values({
    segment: body.segment, gradeYear, subject: body.subject.trim(),
    academicYear: Number.isInteger(academicYear) && academicYear >= 2000 && academicYear <= 2100 ? academicYear : null,
    bimester: Number.isInteger(bimester) && bimester >= 1 && bimester <= 4 ? bimester : null,
    skillCodes,
    action: body.action.trim(), ownerName: body.ownerName.trim(), dueDate: body.dueDate || null, createdBy: user.id,
  }).returning()
  await recordDecision(db, { entityType: 'intervencao', entityId: created.id, planId: await planIdFor(created), action: 'intervencao_criada', summary: `Intervenção registrada: ${created.action}${skillCodes.length ? ` (${skillCodes.join(', ')})` : ''}`, details: { ownerName: created.ownerName, dueDate: created.dueDate, skillCodes }, actorId: user.id })
  return NextResponse.json({ intervention: created }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const user = await currentManager()
  if (!user) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const body = await req.json()
  const id = Number(body.id)
  if (!Number.isInteger(id) || !['planejada', 'em_andamento', 'concluida'].includes(body.status)) return NextResponse.json({ error: 'Atualização inválida.' }, { status: 400 })
  const [before] = await db.select().from(pedagogicalInterventions).where(eq(pedagogicalInterventions.id, id))
  if (!before) return NextResponse.json({ error: 'Intervenção não encontrada.' }, { status: 404 })
  const [updated] = await db.update(pedagogicalInterventions).set({ status: body.status, updatedAt: new Date() }).where(and(eq(pedagogicalInterventions.id, id))).returning()
  if (before.status !== updated.status) await recordDecision(db, { entityType: 'intervencao', entityId: id, planId: await planIdFor(updated), action: `intervencao_${updated.status}`, summary: `Intervenção "${updated.action}": ${before.status} → ${updated.status}`, details: { from: before.status, to: updated.status }, actorId: user.id })
  return NextResponse.json({ intervention: updated })
}
