import { NextResponse } from 'next/server'
import { getHistory, getVersionChain } from '@/lib/pedagogical/classificationService'
import {
  getCurrentApiUser,
  handlePedagogicalApiError,
  parseRouteId,
} from '@/app/api/pedagogical/_helpers/auth'

export async function GET(_req: Request, props: { params: Promise<{ classificationId: string }> }) {
  const params = await props.params;
  const { response } = await getCurrentApiUser()
  if (response) return response

  const parsedId = parseRouteId(params.classificationId, 'classificationId')
  if (parsedId.response) return parsedId.response

  try {
    const [history, versionChain] = await Promise.all([
      getHistory(parsedId.id),
      getVersionChain(parsedId.id),
    ])
    return NextResponse.json({ history, versionChain })
  } catch (error) {
    return handlePedagogicalApiError(error)
  }
}
