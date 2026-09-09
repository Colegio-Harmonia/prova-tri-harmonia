import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { auth } from '@/auth/auth'
import { importImageFromUrl } from '@/lib/images/questionImageService'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'

const bodySchema = z.object({
  questionNumber: z.number().int(),
  url: z.string().url(),
})

// Complementa request-image (busca/gera automaticamente): aqui o professor
// já achou a imagem/mapa/gráfico certo em algum lugar (ex: um mapa temático
// com dados reais que IA nenhuma reproduziria de forma confiável) e só cola
// o link — mesmo pipeline de aprovar/rejeitar depois na tela de revisão.
export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'URL inválida.' }, { status: 400 })

  const authResult = await authorizeExamAccess(examId, session.user.email)
  if ('error' in authResult) return authResult.error
  const { exam } = authResult
  const editableStatuses = ['rascunho', 'atribuido', 'em_andamento', 'revisao_concluida']
  if (!editableStatuses.includes(exam.status)) {
    return NextResponse.json({ error: 'Só é possível adicionar imagens antes da prova ser aprovada.' }, { status: 409 })
  }

  const payload = exam.generationPayload as ExamGenerationResult
  const question = payload.questions.find((q) => q.number === parsed.data.questionNumber)
  if (!question) return NextResponse.json({ error: 'Questão não encontrada.' }, { status: 404 })

  try {
    const imported = await importImageFromUrl(parsed.data.url)
    question.needsImage = true
    question.image = { ...imported, approved: false }

    await db.update(generatedExams).set({ generationPayload: payload }).where(eq(generatedExams.id, examId))

    return NextResponse.json({ ok: true, image: question.image })
  } catch (err) {
    console.error('[exams/import-image] erro:', err)
    const message = err instanceof Error ? err.message : 'Erro ao importar imagem do link.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
