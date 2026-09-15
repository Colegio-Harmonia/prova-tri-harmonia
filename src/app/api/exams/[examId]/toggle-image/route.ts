import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { auth } from '@/auth/auth'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'

const bodySchema = z.object({
  questionNumber: z.number().int(),
  approved: z.boolean().optional(),
  remove: z.boolean().optional().default(false),
}).superRefine((data, ctx) => {
  if (!data.remove && typeof data.approved !== 'boolean') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe a decisão da imagem.' })
  }
})

export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 })

  const authResult = await authorizeExamAccess(examId, session.user.email)
  if ('error' in authResult) return authResult.error
  const { exam } = authResult
  // `em_revisao` é o estado formal atual. Sem ele, a interface mostrava a
  // aprovação de imagem mas o servidor a recusava, travando a prova.
  const editableStatuses = ['rascunho', 'atribuido', 'em_andamento', 'revisao_concluida', 'em_revisao']
  if (!editableStatuses.includes(exam.status)) {
    return NextResponse.json({ error: 'Só é possível alterar imagens antes da prova ser aprovada.' }, { status: 409 })
  }

  const payload = exam.generationPayload as ExamGenerationResult
  const question = payload.questions.find((q) => q.number === parsed.data.questionNumber)
  if (!question?.image) return NextResponse.json({ error: 'Questão não tem imagem associada.' }, { status: 404 })

  if (parsed.data.remove) {
    // Remover é uma decisão humana explícita: a questão volta a não usar
    // recurso visual e deixa de gerar pendência de aprovação de imagem.
    // O arquivo no Drive não é apagado pois pode ser um item reutilizado;
    // só o vínculo desta questão é removido.
    question.imageHistory = [...(question.imageHistory ?? []), { ...question.image, replacedAt: new Date().toISOString(), changedBy: session.user.email }]
    question.imageAuditLog = [...(question.imageAuditLog ?? []), { action: 'removed', at: new Date().toISOString(), actor: session.user.email, driveFileId: question.image.driveFileId }]
    question.image = null
    question.needsImage = false
    question.imageQuery = null
  } else {
    question.image.approved = parsed.data.approved!
    question.imageAuditLog = [...(question.imageAuditLog ?? []), { action: parsed.data.approved ? 'approved' : 'unapproved', at: new Date().toISOString(), actor: session.user.email, driveFileId: question.image.driveFileId }]
  }

  await db.update(generatedExams).set({ generationPayload: payload }).where(eq(generatedExams.id, examId))

  return NextResponse.json({ ok: true, removed: parsed.data.remove })
}
