import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { TabResolutionError } from '@/lib/sheets/tabResolver'
import { SheetNotConfiguredError } from '@/config/gradeSheets'
import { auth } from '@/auth/auth'

const bodySchema = z.object({
  segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']),
  gradeYear: z.number().int(),
  subject: z.string().min(1),
  bimester: z.number().int().min(1).max(4).optional(),
})

// Já protegida pelo middleware (matcher inclui /api/curriculum/:path*),
// mas checa aqui também — mesma camada dupla que todas as outras rotas
// da API usam, pra não ficar dependendo só de um matcher de middleware
// nunca ser alterado por engano.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const selection = await getCurriculumForExam(parsed.data)
    return NextResponse.json(selection)
  } catch (err) {
    if (err instanceof TabResolutionError) {
      return NextResponse.json({ error: err.message, availableTabs: err.availableTabs }, { status: 422 })
    }
    if (err instanceof SheetNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    console.error('[curriculum/preview] erro inesperado:', err)
    return NextResponse.json({ error: 'Erro ao ler a planilha de currículo.' }, { status: 500 })
  }
}
