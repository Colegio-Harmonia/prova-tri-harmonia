import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

const bodySchema = z.object({ questionNumber: z.number().int().positive(), driveFileId: z.string().min(1) })
const EDITABLE_STATUSES = ['rascunho', 'atribuido', 'em_andamento', 'revisao_concluida', 'em_revisao']

/** Restoring only changes the review image; grading, answers and exam status are untouched. */
export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const { examId: rawExamId } = await props.params
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const examId = Number(rawExamId); const parsed = bodySchema.safeParse(await req.json())
  if (!Number.isSafeInteger(examId) || !parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 })
  const access = await authorizeExamAccess(examId, session.user.email)
  if ('error' in access) return access.error
  if (!EDITABLE_STATUSES.includes(access.exam.status)) return NextResponse.json({ error: 'Só é possível restaurar imagens durante a revisão.' }, { status: 409 })
  const payload = access.exam.generationPayload as ExamGenerationResult
  const question = payload.questions.find((item) => item.number === parsed.data.questionNumber)
  const version = question?.imageHistory?.find((item) => item.driveFileId === parsed.data.driveFileId)
  if (!question || !version) return NextResponse.json({ error: 'Versão de imagem não encontrada.' }, { status: 404 })
  const now = new Date().toISOString()
  if (question.image) question.imageHistory = [...(question.imageHistory ?? []), { ...question.image, replacedAt: now, changedBy: session.user.email }]
  question.image = { source: version.source, driveFileId: version.driveFileId, previewUrl: version.previewUrl, approved: false, sourceUrl: version.sourceUrl, provenance: version.provenance }
  question.needsImage = true
  question.imageAuditLog = [...(question.imageAuditLog ?? []), { action: 'restored', at: now, actor: session.user.email, driveFileId: version.driveFileId }]
  await db.update(generatedExams).set({ generationPayload: payload }).where(eq(generatedExams.id, examId))
  return NextResponse.json({ ok: true, image: question.image, imageHistory: question.imageHistory, imageAuditLog: question.imageAuditLog })
}
