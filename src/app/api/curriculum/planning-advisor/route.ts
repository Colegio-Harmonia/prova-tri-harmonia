import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { SheetNotConfiguredError } from '@/config/gradeSheets'
import { TabResolutionError } from '@/lib/sheets/tabResolver'
import { runPlanningAdvisor } from '@/lib/planningAdvisor/service'

const bodySchema = z.object({
  segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']),
  gradeYear: z.number().int(),
  subject: z.string().min(1),
  academicYear: z.number().int().min(2020).max(2100).optional(),
  withSuggestions: z.boolean().optional(),
})

// As sugestões fazem 1 chamada de IA a cada 15 capítulos.
export const maxDuration = 300

// Assistente de Planejamento: só LEITURA. Analisa o plano de curso da
// planilha e recomenda; nunca escreve na planilha nem no planejamento
// interno. Aberto a qualquer usuário autenticado; rascunho do Planejamento só
// é lido por quem pode vê-lo (ver getBimesterPlanSelections).
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!user?.active) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const report = await runPlanningAdvisor({ ...parsed.data, viewer: { id: user.id, role: user.role }, withSuggestions: parsed.data.withSuggestions ?? false })
    return NextResponse.json(report)
  } catch (err) {
    if (err instanceof TabResolutionError) {
      return NextResponse.json({ error: err.message, availableTabs: err.availableTabs }, { status: 422 })
    }
    if (err instanceof SheetNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    console.error('[curriculum/planning-advisor] erro inesperado:', err)
    return NextResponse.json({ error: 'Erro ao analisar o planejamento.' }, { status: 500 })
  }
}
