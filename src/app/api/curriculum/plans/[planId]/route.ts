import { NextRequest, NextResponse } from 'next/server'
import { idParam, withViewer } from '@/lib/curriculum/planningRoute'
import { getPlanDetail } from '@/lib/curriculum/planningService'

export async function GET(req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params
  return withViewer(async (viewer) => {
    const versionId = req.nextUrl.searchParams.get('versionId')
    return NextResponse.json(await getPlanDetail(viewer, idParam(planId), versionId ? idParam(versionId) : undefined))
  })
}
