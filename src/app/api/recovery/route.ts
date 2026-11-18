import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { RecoveryRoundStatus } from '@/db/schema'
import { listRounds, openRound } from '@/lib/recovery/recoveryService'
import { RECOVERY_RULES } from '@/lib/recovery/recoveryPlan'
import { recoveryErrorResponse, recoveryViewer } from '@/lib/recovery/routeHelpers'

// Lotes de recuperação. Professor vê os que abriu; coordenação/direção, todos.
// `?fila=1` devolve só os lotes aprovados/impressos (fila de impressão).
export async function GET(req: NextRequest) {
  const access = await recoveryViewer()
  if ('error' in access) return access.error
  try {
    const classroomCourseId = req.nextUrl.searchParams.get('classroomCourseId') ?? undefined
    const queue = req.nextUrl.searchParams.get('fila') === '1'
    const rounds = await listRounds(access.viewer, { classroomCourseId, ...(queue ? { statuses: ['aprovado', 'impresso'] as RecoveryRoundStatus[] } : {}) })
    return NextResponse.json({ rounds })
  } catch (error) {
    return recoveryErrorResponse(error, 'listar lotes')
  }
}

const openSchema = z.object({
  classroomCourseId: z.string().min(1).max(64),
  classLabel: z.string().min(1).max(160),
  subject: z.string().min(1).max(120),
  bimester: z.number().int().min(1).max(4).nullable(),
  semester: z.number().int().min(1).max(2).nullable().optional(),
  questionCount: z.number().int().min(RECOVERY_RULES.minQuestions).max(RECOVERY_RULES.maxQuestions).optional(),
  questionSource: z.enum(['acervo', 'ia']).optional(),
  objectivePercentage: z.number().int().min(0).max(100).optional(),
})

export async function POST(req: NextRequest) {
  const access = await recoveryViewer()
  if ('error' in access) return access.error
  const parsed = openSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos.', issues: parsed.error.issues }, { status: 400 })
  try {
    const round = await openRound(parsed.data, access.viewer)
    return NextResponse.json({ round })
  } catch (error) {
    return recoveryErrorResponse(error, 'abrir lote')
  }
}
