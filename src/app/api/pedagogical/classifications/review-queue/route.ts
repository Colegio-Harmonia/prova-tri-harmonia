import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { CLASSIFIABLE_TYPES } from '@/db/schema'
import { getReviewQueue } from '@/lib/pedagogical/classificationService'
import {
  getCurrentApiUser,
  handlePedagogicalApiError,
} from '@/app/api/pedagogical/_helpers/auth'

const querySchema = z.object({
  classifiableType: z.enum(CLASSIFIABLE_TYPES).optional(),
  taxonomyCode: z.string().min(1).optional(),
  status: z.enum(['sugerida', 'em_revisao']).optional(),
  requiresHumanReviewOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
})

export async function GET(req: NextRequest) {
  const { response } = await getCurrentApiUser()
  if (response) return response

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const classifications = await getReviewQueue(parsed.data)
    return NextResponse.json({ classifications })
  } catch (error) {
    return handlePedagogicalApiError(error)
  }
}
