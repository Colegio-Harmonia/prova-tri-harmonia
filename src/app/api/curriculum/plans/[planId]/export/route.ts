import { NextRequest } from 'next/server'
import { idParam, withViewer } from '@/lib/curriculum/planningRoute'
import { exportPlanCsv } from '@/lib/curriculum/planningService'

// Planilha (CSV ";" com BOM UTF-8). O PDF sai da página /planejamento/[id]/imprimir.
export async function GET(req: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params
  return withViewer(async (viewer) => {
    const versionId = req.nextUrl.searchParams.get('versionId')
    const file = await exportPlanCsv(viewer, idParam(planId), versionId ? idParam(versionId) : undefined)
    return new Response(file.body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${file.filename}"` } })
  })
}
