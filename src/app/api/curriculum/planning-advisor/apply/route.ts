import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withViewer } from '@/lib/curriculum/planningRoute'
import { applyAdvisorSuggestions } from '@/lib/planningAdvisor/applySuggestions'

const bodySchema = z.object({
  academicYear: z.number().int().min(2020).max(2100),
  segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']),
  gradeYear: z.number().int().min(1).max(9),
  subject: z.string().trim().min(1),
  items: z.array(z.object({
    bimester: z.number().int().min(1).max(4),
    title: z.string().trim().min(1),
    codes: z.array(z.string().trim().min(1)).max(10).optional(),
    objectives: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
  }).refine((item) => (item.codes?.length ?? 0) + (item.objectives?.length ?? 0) > 0, 'Informe ao menos uma habilidade ou um objetivo.')).min(1).max(200),
})

// Leva habilidades ENEM e objetivos escolhidos no Assistente para o RASCUNHO do
// planejamento interno. Permissões e travas são as do planningService
// (responsável pelo planejamento ou coordenação/direção); nunca aprova.
export async function POST(req: NextRequest) {
  return withViewer(async (viewer) => {
    const input = bodySchema.parse(await req.json())
    return NextResponse.json(await applyAdvisorSuggestions(viewer, input))
  })
}
