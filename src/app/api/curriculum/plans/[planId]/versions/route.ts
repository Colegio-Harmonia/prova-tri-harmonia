import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { idParam, withViewer } from '@/lib/curriculum/planningRoute'
import { startNewVersion } from '@/lib/curriculum/planningService'

// Nova versão para alterar um planejamento aprovado/encerrado.
export async function POST(req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params
  return withViewer(async (viewer) => {
    const body = z.object({ note: z.string().trim().max(1000).optional() }).parse(await req.json().catch(() => ({})))
    return NextResponse.json(await startNewVersion(viewer, idParam(planId), body.note), { status: 201 })
  })
}
