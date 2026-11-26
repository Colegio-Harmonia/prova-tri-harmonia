import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { approveRound, generatePlanned, getRound, returnRound, submitRound } from '@/lib/recovery/recoveryService'
import { parseId, recoveryErrorResponse, recoveryViewer } from '@/lib/recovery/routeHelpers'

const schema = z.object({ action: z.enum(['gerar', 'enviar', 'devolver', 'aprovar']) })

// gerar: envia para a fila as provas dos alunos com matriz conferida.
// enviar: professor manda o lote revisado para a coordenação.
// devolver: coordenação/direção reabre o lote para ajustes.
// aprovar: coordenação/direção aprova e gera os Google Docs de cada prova.
export async function POST(req: NextRequest, { params }: { params: Promise<{ roundId: string }> }) {
  const access = await recoveryViewer()
  if ('error' in access) return access.error
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  try {
    const round = await getRound(parseId((await params).roundId), access.viewer)
    if (parsed.data.action === 'gerar') return NextResponse.json(await generatePlanned(round))
    if (parsed.data.action === 'enviar') await submitRound(round, access.viewer)
    if (parsed.data.action === 'devolver') await returnRound(round, access.viewer)
    if (parsed.data.action === 'aprovar') {
      const result = await approveRound(round, access.viewer)
      if (!result.approved) return NextResponse.json({ error: 'Algumas provas não geraram documento. Aprove de novo para tentar só as que faltam.', failures: result.failures }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return recoveryErrorResponse(error, `ação ${parsed.data.action}`)
  }
}
