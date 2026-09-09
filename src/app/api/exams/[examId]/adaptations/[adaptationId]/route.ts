import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { adaptedExams } from '@/db/schema'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { generateAdaptedProvaDoc } from '@/lib/docs/adaptedProvaDoc'
import type { AdaptedExamPayload } from '@/lib/adaptation/adaptExam'
import type { Segment } from '@/types/exam'

// Aprovação da adaptação (Módulo 4): só depois da revisão humana lado a
// lado (pronto_revisao) o documento "Prova Adaptada" é gerado — mesmo
// princípio do resto do projeto: IA sugere, humano aprova.

const bodySchema = z.object({ action: z.literal('aprovar') })

export async function PATCH(req: NextRequest, props: { params: Promise<{ examId: string; adaptationId: string }> }) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const routeParams = await props.params
  const examId = Number(routeParams.examId)
  const adaptationId = Number(routeParams.adaptationId)
  if (!Number.isInteger(examId) || !Number.isInteger(adaptationId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ação inválida', issues: parsed.error.issues }, { status: 400 })
  }

  const authz = await authorizeExamAccess(examId, session.user.email)
  if ('error' in authz) return authz.error
  const { currentUser, exam } = authz

  const adaptation = await db.query.adaptedExams.findFirst({ where: eq(adaptedExams.id, adaptationId) })
  if (!adaptation || adaptation.examId !== examId) {
    return NextResponse.json({ error: 'Adaptação não encontrada' }, { status: 404 })
  }
  if (adaptation.status !== 'pronto_revisao') {
    return NextResponse.json({ error: 'Só é possível aprovar uma adaptação pronta pra revisão.' }, { status: 409 })
  }
  if (!adaptation.adaptedPayload) {
    return NextResponse.json({ error: 'Adaptação sem conteúdo gerado.' }, { status: 409 })
  }

  try {
    const doc = await generateAdaptedProvaDoc(
      {
        segment: exam.segment as Segment,
        gradeYear: exam.gradeYear,
        subject: exam.subject,
        bimester: exam.bimester,
        driveFolderId: exam.driveFolderId,
      },
      adaptation.adaptedPayload as AdaptedExamPayload,
    )

    const [updated] = await db
      .update(adaptedExams)
      .set({
        status: 'aprovado',
        approvedBy: currentUser.id,
        approvedAt: new Date(),
        provaAdaptadaDocId: doc.docId,
        provaAdaptadaDocUrl: doc.url,
      })
      .where(eq(adaptedExams.id, adaptationId))
      .returning()

    return NextResponse.json({ adaptation: updated })
  } catch (err) {
    console.error('[adaptations] erro ao aprovar/gerar documento:', err)
    const message = err instanceof Error ? err.message : 'Erro ao gerar o documento da prova adaptada.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
