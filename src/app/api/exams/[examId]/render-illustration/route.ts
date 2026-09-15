import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { uploadToStaging } from '@/lib/images/questionImageService'
import { getIllustrationGenerator } from '@/lib/illustrations/registry'

const bodySchema = z.object({
  questionNumber: z.number().int().positive(),
  generator: z.string().min(1).max(80),
  parameters: z.unknown(),
})

const EDITABLE_STATUSES = ['rascunho', 'atribuido', 'em_andamento', 'revisao_concluida', 'em_revisao']

/** Generates a deterministic, reviewable illustration and attaches it to one question. */
export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const { examId: rawExamId } = await props.params
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(rawExamId)
  if (!Number.isSafeInteger(examId) || examId <= 0) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 })

  const authResult = await authorizeExamAccess(examId, session.user.email)
  if ('error' in authResult) return authResult.error
  const { exam } = authResult
  if (!EDITABLE_STATUSES.includes(exam.status)) {
    return NextResponse.json({ error: 'Só é possível adicionar ilustrações antes da prova ser aprovada.' }, { status: 409 })
  }

  const payload = exam.generationPayload as ExamGenerationResult
  const question = payload.questions.find((item) => item.number === parsed.data.questionNumber)
  if (!question) return NextResponse.json({ error: 'Questão não encontrada.' }, { status: 404 })
  const generator = getIllustrationGenerator(parsed.data.generator)
  if (!generator) return NextResponse.json({ error: 'Gerador de ilustração indisponível.' }, { status: 400 })
  const normalizedSubject = exam.subject.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (generator.subject !== normalizedSubject) return NextResponse.json({ error: 'Este gerador não é compatível com a disciplina da prova.' }, { status: 422 })

  try {
    const rendered = await generator.render(parsed.data.parameters)
    const png = rendered.mimeType === 'image/png' ? rendered.content : await sharp(rendered.content, { density: 180 }).png().toBuffer()
    const { driveFileId, previewUrl } = await uploadToStaging(png, 'image/png', `grafico-funcao-q${question.number}-${Date.now()}.png`)

    question.needsImage = true
    question.image = {
      source: 'diagrama',
      driveFileId,
      previewUrl,
      approved: false,
      provenance: rendered.provenance,
    }
    await db.update(generatedExams).set({ generationPayload: payload }).where(eq(generatedExams.id, examId))
    return NextResponse.json({ ok: true, image: question.image })
  } catch (error) {
    console.error('[exams/render-illustration] erro:', error)
    const message = error instanceof Error ? error.message : 'Não foi possível gerar a ilustração.'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
