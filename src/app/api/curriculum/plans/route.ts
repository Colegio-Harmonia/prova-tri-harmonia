import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withViewer } from '@/lib/curriculum/planningRoute'
import { createPlan, listPlans } from '@/lib/curriculum/planningService'

const segment = z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio'])
const scope = z.object({ academicYear: z.number().int(), segment, gradeYear: z.number().int(), subject: z.string().trim().min(1), bimester: z.number().int() })

export async function GET(req: NextRequest) {
  return withViewer(async (viewer) => {
    const params = req.nextUrl.searchParams
    const number = (name: string) => (params.get(name) ? Number(params.get(name)) : undefined)
    const plans = await listPlans(viewer, {
      academicYear: number('academicYear'), gradeYear: number('gradeYear'), bimester: number('bimester'),
      segment: segment.optional().parse(params.get('segment') || undefined), subject: params.get('subject') || undefined,
    })
    return NextResponse.json({ plans })
  })
}

export async function POST(req: NextRequest) {
  return withViewer(async (viewer) => NextResponse.json(await createPlan(viewer, scope.parse(await req.json())), { status: 201 }))
}
