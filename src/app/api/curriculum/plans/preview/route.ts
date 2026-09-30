import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { SheetNotConfiguredError } from '@/config/gradeSheets'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { checkSkillDescriptions } from '@/lib/curriculum/skillDescriptionCheck'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { TabResolutionError } from '@/lib/sheets/tabResolver'

// Prévia exclusiva de /planejamento. Separada de /api/curriculum/preview
// (usada também por /gerar e /atividades) para que a conferência das
// descrições pelo Jev não acrescente custo nem latência à geração de prova.
const schema = z.object({
  segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']),
  gradeYear: z.number().int().min(1).max(9),
  subject: z.string().trim().min(1),
  bimester: z.number().int().min(1).max(4),
})

async function requireManager() {
  const session = await auth()
  if (!session?.user?.email) return null
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  return user && isStaffSuperuser(user.role) ? user : null
}

export async function POST(req: NextRequest) {
  if (!await requireManager()) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Recorte inválido.' }, { status: 400 })

  try {
    const selection = await getCurriculumForExam(parsed.data)
    const descriptionChecks = await checkSkillDescriptions(selection.units.flatMap((unit) => unit.habilidades.skills))
    return NextResponse.json({ ...selection, descriptionChecks })
  } catch (err) {
    if (err instanceof TabResolutionError) return NextResponse.json({ error: err.message, availableTabs: err.availableTabs }, { status: 422 })
    if (err instanceof SheetNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 422 })
    console.error('[curriculum/plans/preview] erro inesperado:', err)
    return NextResponse.json({ error: 'Erro ao ler a planilha de currículo.' }, { status: 500 })
  }
}
