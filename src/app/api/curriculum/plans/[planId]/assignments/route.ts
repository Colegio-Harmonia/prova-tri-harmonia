import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { idParam, withViewer } from '@/lib/curriculum/planningRoute'
import { setAssignment } from '@/lib/curriculum/planningService'

// Atribui (ou remove, com responsibility null) um professor ao planejamento.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params
  return withViewer(async (viewer) => {
    const body = z.object({ userId: z.number().int().positive(), responsibility: z.enum(['responsavel', 'colaborador']).nullable() }).parse(await req.json())
    return NextResponse.json(await setAssignment(viewer, idParam(planId), body.userId, body.responsibility))
  })
}
