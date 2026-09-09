import { NextResponse } from 'next/server'
import { z } from 'zod'
import { beginReview } from '@/lib/pedagogical/classificationService'
import {
  getCurrentApiUser,
  handlePedagogicalApiError,
  parseRouteId,
} from '@/app/api/pedagogical/_helpers/auth'

const bodySchema = z.object({
  reason: z.string().nullable().optional(),
})

export async function POST(req: Request, props: { params: Promise<{ classificationId: string }> }) {
  const params = await props.params;
  const { user, response } = await getCurrentApiUser()
  if (response) return response

  const parsedId = parseRouteId(params.classificationId, 'classificationId')
  if (parsedId.response) return parsedId.response

  const body = await req.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const classification = await beginReview(parsedId.id, user.id, parsed.data.reason)
    return NextResponse.json({ classification })
  } catch (error) {
    return handlePedagogicalApiError(error)
  }
}
