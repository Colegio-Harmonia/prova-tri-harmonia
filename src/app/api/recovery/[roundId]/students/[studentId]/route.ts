import { NextResponse } from 'next/server'
import { getRound, regenerateStudent, removeStudent } from '@/lib/recovery/recoveryService'
import { parseId, recoveryErrorResponse, recoveryViewer } from '@/lib/recovery/routeHelpers'

type Params = { params: Promise<{ roundId: string; studentId: string }> }

// Gera de novo a prova do aluno (mesma matriz de habilidades).
export async function POST(_req: Request, { params }: Params) {
  const access = await recoveryViewer()
  if ('error' in access) return access.error
  try {
    const { roundId, studentId } = await params
    const round = await getRound(parseId(roundId), access.viewer)
    await regenerateStudent(round, parseId(studentId), access.viewer)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return recoveryErrorResponse(error, 'regenerar prova')
  }
}

// Tira o aluno do lote; a prova dele é arquivada, não apagada.
export async function DELETE(_req: Request, { params }: Params) {
  const access = await recoveryViewer()
  if ('error' in access) return access.error
  try {
    const { roundId, studentId } = await params
    const round = await getRound(parseId(roundId), access.viewer)
    await removeStudent(round, parseId(studentId))
    return NextResponse.json({ ok: true })
  } catch (error) {
    return recoveryErrorResponse(error, 'remover aluno')
  }
}
