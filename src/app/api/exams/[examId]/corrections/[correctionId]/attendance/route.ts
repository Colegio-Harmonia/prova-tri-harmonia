import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq, sql } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examCorrections } from '@/db/schema'
import { loadExamAndAuthorize, CORRECTABLE_STATUSES } from '@/lib/corrections/authorize'
import { updateExamCorrectionStatus } from '@/lib/corrections/updateExamCorrectionStatus'

const bodySchema = z.object({
  attendanceStatus: z.enum(['presente', 'ausente']),
})

export async function PATCH(req: NextRequest, props: { params: Promise<{ examId: string; correctionId: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  const correctionId = Number(params.correctionId)
  if (!Number.isInteger(examId) || !Number.isInteger(correctionId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })

  const access = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in access) return access.error
  if (!CORRECTABLE_STATUSES.includes(access.exam.status)) {
    return NextResponse.json({ error: 'A presença só pode ser alterada depois que a prova foi aplicada.' }, { status: 409 })
  }

  const updated = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${correctionId})`)
    const correction = await tx.query.examCorrections.findFirst({
      where: and(eq(examCorrections.id, correctionId), eq(examCorrections.examId, examId)),
    })
    if (!correction) return { error: 'Correção não encontrada', status: 404 as const }
    if (correction.gradeReturnedAt) {
      return { error: 'A nota deste aluno já foi lançada no Classroom. Atualize a nota no Classroom antes de alterar a presença.', status: 409 as const }
    }

    const isAbsent = parsed.data.attendanceStatus === 'ausente'
    const [row] = await tx.update(examCorrections)
      .set({
        attendanceStatus: parsed.data.attendanceStatus,
        absenceMarkedAt: isAbsent ? new Date() : null,
        absenceMarkedBy: isAbsent ? access.currentUser.id : null,
        status: 'pendente',
        scoreResult: null,
        updatedAt: new Date(),
      })
      .where(eq(examCorrections.id, correctionId))
      .returning()
    return { correction: row, status: 200 as const }
  })

  if ('error' in updated) return NextResponse.json({ error: updated.error }, { status: updated.status })
  await updateExamCorrectionStatus(examId)
  return NextResponse.json({ correction: updated.correction })
}
