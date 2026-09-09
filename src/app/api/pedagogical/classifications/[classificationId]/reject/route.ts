import { NextResponse } from 'next/server'
import { z } from 'zod'
import { reject } from '@/lib/pedagogical/classificationService'
import {
  getCurrentApiUser,
  handlePedagogicalApiError,
  parseRouteId,
} from '@/app/api/pedagogical/_helpers/auth'

const bodySchema = z.object({
  reason: z.string().min(1),
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
    const classification = await reject(parsedId.id, parsed.data.reason, user.id)
    return NextResponse.json({ classification })
  } catch (error) {
    return handlePedagogicalApiError(error)
  }
}
