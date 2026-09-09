import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CLASSIFIABLE_TYPES, CLASSIFICATION_SOURCES } from '@/db/schema'
import { supersede } from '@/lib/pedagogical/classificationService'
import {
  getCurrentApiUser,
  handlePedagogicalApiError,
  parseRouteId,
} from '@/app/api/pedagogical/_helpers/auth'

const bodySchema = z.object({
  classifiableType: z.enum(CLASSIFIABLE_TYPES),
  classifiableId: z.number().int().positive(),
  classifiableSubId: z.number().int().positive().nullable().optional(),
  taxonomyCode: z.string().min(1),
  categoryCode: z.string().min(1),
  confidence: z.number().min(0).max(1).nullable().optional(),
  source: z.enum(CLASSIFICATION_SOURCES),
  explanation: z.string().nullable().optional(),
  evidence: z.string().nullable().optional(),
  manualVersion: z.string().nullable().optional(),
  modelProvider: z.string().nullable().optional(),
  modelName: z.string().nullable().optional(),
  promptVersion: z.string().nullable().optional(),
  isPrimary: z.boolean().optional(),
  reason: z.string().nullable().optional(),
})

export async function POST(req: Request, props: { params: Promise<{ classificationId: string }> }) {
  const params = await props.params;
  const { user, response } = await getCurrentApiUser()
  if (response) return response

  const parsedId = parseRouteId(params.classificationId, 'classificationId')
  if (parsedId.response) return parsedId.response

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const classification = await supersede(
      parsedId.id,
      { ...parsed.data, createdBy: user.id },
      user.id,
    )
    return NextResponse.json({ classification }, { status: 201 })
  } catch (error) {
    return handlePedagogicalApiError(error)
  }
}
