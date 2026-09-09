import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { markOutdatedByManualVersion } from '@/lib/pedagogical/classificationService'
import {
  getCurrentApiUser,
  handlePedagogicalApiError,
} from '@/app/api/pedagogical/_helpers/auth'

const bodySchema = z.object({
  taxonomyCode: z.string().min(1).optional(),
  fromManualVersion: z.string().min(1),
  toManualVersion: z.string().min(1),
  reason: z.string().nullable().optional(),
})

export async function POST(req: NextRequest) {
  const { user, response } = await getCurrentApiUser()
  if (response) return response

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const classifications = await markOutdatedByManualVersion({
      ...parsed.data,
      performedBy: user.id,
    })
    return NextResponse.json({ updated: classifications.length, classifications })
  } catch (error) {
    return handlePedagogicalApiError(error)
  }
}
