import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth/auth'
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
// interno. Aberto a qualquer usuário autenticado (professor, coordenação,
// direção), como a pré-visualização de currículo que já existe.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const report = await runPlanningAdvisor({ ...parsed.data, withSuggestions: parsed.data.withSuggestions ?? false })
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
