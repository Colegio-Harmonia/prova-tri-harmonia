import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withViewer } from '@/lib/curriculum/planningRoute'
import { copyYear } from '@/lib/curriculum/planningService'

// Copia os planejamentos aprovados de um ano para rascunhos do ano seguinte.
export async function POST(req: NextRequest) {
  return withViewer(async (viewer) => {
    const body = z.object({
      fromYear: z.number().int(), toYear: z.number().int(),
      segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']).optional(), gradeYear: z.number().int().optional(), subject: z.string().trim().min(1).optional(),
    }).parse(await req.json())
    return NextResponse.json(await copyYear(viewer, body.fromYear, body.toYear, body))
  })
}
