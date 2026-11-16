import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { PREREQUISITE_STATUSES, PREREQUISITE_STRENGTHS, users } from '@/db/schema'
import { createManualPrerequisite, currentAcademicYear, listPlanningOptions, listPrerequisites, loadSkillCatalogWithIssues, PrerequisiteError } from '@/lib/curriculum/prerequisiteService'

async function currentUser() {
  const session = await auth()
  if (!session?.user?.email) return null
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  return user?.active ? user : null
}

const listSchema = z.object({
  subject: z.string().min(1).optional(),
  segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']).optional(),
  gradeYear: z.coerce.number().int().optional(),
  status: z.enum(PREREQUISITE_STATUSES).optional(),
})

// Mapa institucional de pré-requisitos: qualquer usuário autenticado lê.
export async function GET(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const parsed = listSchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  const academicYear = await currentAcademicYear()
  const [prerequisites, options, catalog] = await Promise.all([
    listPrerequisites(parsed.data),
    listPlanningOptions(academicYear),
    // Descrição de cada código para quem revisa (planejamento ou BNCC oficial).
    parsed.data.subject ? loadSkillCatalogWithIssues(parsed.data.subject) : Promise.resolve(null),
  ])
  const descriptions: Record<string, string> = {}
  for (const skill of catalog?.skills ?? []) if (skill.description && !descriptions[skill.code]) descriptions[skill.code] = skill.description
  // Códigos de outra disciplina no planejamento da série escolhida: ficam fora da sugestão.
  const ignored = (catalog?.ignored ?? [])
    .filter((skill) => (!parsed.data.segment || skill.segment === parsed.data.segment) && (!parsed.data.gradeYear || skill.gradeYear === parsed.data.gradeYear))
    .map((skill) => ({ code: skill.code, bimester: skill.bimester, reason: skill.reason }))
  return NextResponse.json({ prerequisites, options, descriptions, academicYear, ignored })
}

const createSchema = z.object({
  subject: z.string().min(1),
  prerequisiteCode: z.string().min(4).max(20),
  skillCode: z.string().min(4).max(20),
  strength: z.enum(PREREQUISITE_STRENGTHS),
  rationale: z.string().trim().min(10).max(400),
})

// Cadastro direto pela coordenação/direção (já nasce aprovado).
export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  try {
    return NextResponse.json({ prerequisite: await createManualPrerequisite({ viewer: user, ...parsed.data }) })
  } catch (error) {
    if (error instanceof PrerequisiteError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
