import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withViewer } from '@/lib/curriculum/planningRoute'
import { closeBimester } from '@/lib/curriculum/planningService'

// Encerra o bimestre: trava a versão oficial de cada planejamento do recorte.
export async function POST(req: NextRequest) {
  return withViewer(async (viewer) => {
    const body = z.object({
      academicYear: z.number().int(), bimester: z.number().int().min(1).max(4),
      segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']).optional(), gradeYear: z.number().int().optional(), subject: z.string().trim().min(1).optional(),
    }).parse(await req.json())
    return NextResponse.json(await closeBimester(viewer, body.academicYear, body.bimester, body))
  })
}
