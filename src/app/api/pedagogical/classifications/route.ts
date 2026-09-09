import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { CLASSIFIABLE_TYPES, CLASSIFICATION_SOURCES } from '@/db/schema'
import {
  getCurrent,
  getFullClassification,
  suggest,
} from '@/lib/pedagogical/classificationService'
import {
  getCurrentApiUser,
  handlePedagogicalApiError,
} from '@/app/api/pedagogical/_helpers/auth'

const querySchema = z.object({
  classifiableType: z.enum(CLASSIFIABLE_TYPES),
  classifiableId: z.coerce.number().int().positive(),
  classifiableSubId: z.coerce.number().int().positive().optional(),
  taxonomyCode: z.string().min(1).optional(),
})

const suggestSchema = z.object({
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
})

export async function GET(req: NextRequest) {
  const { response } = await getCurrentApiUser()
  if (response) return response

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  }

  const { classifiableType, classifiableId, classifiableSubId, taxonomyCode } = parsed.data

  try {
    if (taxonomyCode) {
      const classification = await getCurrent(classifiableType, classifiableId, classifiableSubId, taxonomyCode)
      return NextResponse.json({ classification })
    }

    const classifications = await getFullClassification(classifiableType, classifiableId, classifiableSubId)
    return NextResponse.json({ classifications })
  } catch (error) {
    return handlePedagogicalApiError(error)
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = await getCurrentApiUser()
  if (response) return response

  const parsed = suggestSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const classification = await suggest({ ...parsed.data, createdBy: user.id })
    return NextResponse.json({ classification }, { status: 201 })
  } catch (error) {
    return handlePedagogicalApiError(error)
  }
}
