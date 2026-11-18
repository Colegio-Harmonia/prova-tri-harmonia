import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getRound, regenerateStudent, removeStudent, updateStudentPlan } from '@/lib/recovery/recoveryService'
import { parseId, recoveryErrorResponse, recoveryViewer } from '@/lib/recovery/routeHelpers'

type Params = { params: Promise<{ roundId: string; studentId: string }> }

// Volta o aluno para a Conferência (matriz editável) e arquiva a prova atual.
export async function POST(_req: Request, { params }: Params) {
  const access = await recoveryViewer()
  if ('error' in access) return access.error
  try {
    const { roundId, studentId } = await params
    const round = await getRound(parseId(roundId), access.viewer)
    await regenerateStudent(round, parseId(studentId))
    return NextResponse.json({ ok: true })
  } catch (error) {
    return recoveryErrorResponse(error, 'regenerar prova')
  }
}

const planSchema = z.object({
  contentPlan: z.array(z.object({
    unitRowIndex: z.number().int().min(0),
    questionCount: z.number().int().min(0).max(30),
    priority: z.enum(['alta', 'media', 'baixa']).default('alta'),
    visualAid: z.enum(['auto', 'obrigatorio', 'sem_imagem']).default('auto'),
  })).min(1).max(60),
})

// Matriz por capítulo do aluno, ajustada na Conferência.
export async function PATCH(req: NextRequest, { params }: Params) {
  const access = await recoveryViewer()
  if ('error' in access) return access.error
  const parsed = planSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Matriz inválida.', issues: parsed.error.issues }, { status: 400 })
  try {
    const { roundId, studentId } = await params
    const round = await getRound(parseId(roundId), access.viewer)
    await updateStudentPlan(round, parseId(studentId), parsed.data.contentPlan)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return recoveryErrorResponse(error, 'matriz do aluno')
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
