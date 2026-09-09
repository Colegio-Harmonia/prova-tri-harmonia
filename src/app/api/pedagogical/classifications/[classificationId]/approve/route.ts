import { NextResponse } from 'next/server'
import { approve } from '@/lib/pedagogical/classificationService'
import {
  getCurrentApiUser,
  handlePedagogicalApiError,
  parseRouteId,
} from '@/app/api/pedagogical/_helpers/auth'

export async function POST(_req: Request, props: { params: Promise<{ classificationId: string }> }) {
  const params = await props.params;
  const { user, response } = await getCurrentApiUser()
  if (response) return response

  const parsedId = parseRouteId(params.classificationId, 'classificationId')
  if (parsedId.response) return parsedId.response

  try {
    const classification = await approve(parsedId.id, user.id)
    return NextResponse.json({ classification })
  } catch (error) {
    return handlePedagogicalApiError(error)
  }
}
