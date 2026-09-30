import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { idParam, withViewer } from '@/lib/curriculum/planningRoute'
import { saveDraft } from '@/lib/curriculum/planningService'

const unit = z.object({
  title: z.string(),
  content: z.string().nullable().optional(),
  objectives: z.string().nullable().optional(),
  skills: z.array(z.object({ code: z.string(), description: z.string().nullable().optional(), targetMasteryPercent: z.number().int().optional() })).max(60),
})

// Salva o conteúdo completo de um rascunho (unidades, conteúdos, objetivos e habilidades).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params
  return withViewer(async (viewer) => {
    const body = z.object({ units: z.array(unit).max(40) }).parse(await req.json())
    return NextResponse.json(await saveDraft(viewer, idParam(versionId), body.units))
  })
}
