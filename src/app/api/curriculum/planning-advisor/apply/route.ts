import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withViewer } from '@/lib/curriculum/planningRoute'
import { applyEnemSuggestions } from '@/lib/planningAdvisor/applySuggestions'

const bodySchema = z.object({
  academicYear: z.number().int().min(2020).max(2100),
  segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']),
  gradeYear: z.number().int().min(1).max(9),
  subject: z.string().trim().min(1),
  items: z.array(z.object({
    bimester: z.number().int().min(1).max(4),
    title: z.string().trim().min(1),
    codes: z.array(z.string().trim().min(1)).min(1).max(10),
  })).min(1).max(200),
})

// Leva habilidades ENEM escolhidas no Assistente para o RASCUNHO do
// planejamento interno. Permissões e travas são as do planningService
// (responsável pelo planejamento ou coordenação/direção); nunca aprova.
export async function POST(req: NextRequest) {
  return withViewer(async (viewer) => {
    const input = bodySchema.parse(await req.json())
    return NextResponse.json(await applyEnemSuggestions(viewer, input))
  })
}
