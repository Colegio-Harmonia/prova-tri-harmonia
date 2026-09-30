import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { idParam, withViewer } from '@/lib/curriculum/planningRoute'
import { transitionVersion } from '@/lib/curriculum/planningService'

// Fluxo: rascunho → em_revisao (professor ou gestão) → aprovado ou devolvido (gestão) → encerrado (gestão).
export async function POST(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params
  return withViewer(async (viewer) => {
    const body = z.object({ to: z.enum(['rascunho', 'em_revisao', 'aprovado', 'encerrado']), note: z.string().trim().max(1000).optional() }).parse(await req.json())
    return NextResponse.json(await transitionVersion(viewer, idParam(versionId), body.to, body.note))
  })
}
