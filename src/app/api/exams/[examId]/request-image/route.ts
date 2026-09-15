import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { auth } from '@/auth/auth'
import { resolveQuestionImage } from '@/lib/images/questionImageService'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'

const bodySchema = z.object({
  questionNumber: z.number().int(),
  query: z.string().min(1).optional(),
  expectedText: z.string().trim().min(1).max(600).optional(),
  force: z.boolean().optional().default(false),
})

// Diferente de needsImage/imageQuery (decidido pela IA e limitado a
// isImageEligibleSubject — ver imageEligibleSubjects.ts), aqui é um pedido
// explícito do professor revisor: ele escreveu o que quer (gráfico, mapa,
// ilustração), então o gate de "disciplina habilitada pra imagem" não se
// aplica — é uma decisão humana deliberada, não a IA inventando por conta
// própria. Mesmo pipeline de busca/geração (Wikimedia → IA de fallback).
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
  const editableStatuses = ['rascunho', 'atribuido', 'em_andamento', 'revisao_concluida', 'em_revisao']
  if (!editableStatuses.includes(exam.status)) {
    return NextResponse.json({ error: 'Só é possível adicionar imagens antes da prova ser aprovada.' }, { status: 409 })
  }

  const payload = exam.generationPayload as ExamGenerationResult
  const question = payload.questions.find((q) => q.number === parsed.data.questionNumber)
  if (!question) return NextResponse.json({ error: 'Questão não encontrada.' }, { status: 404 })

  // A primeira ação usa a análise já feita na geração da questão. Quando o
  // item não exige visual, o professor recebe uma confirmação clara antes
  // de gastar uma geração de imagem por escolha deliberada.
  if (!parsed.data.force && !question.needsImage && !question.imageQuery) {
    return NextResponse.json({
      needsConfirmation: true,
      message: 'A análise pedagógica indica que esta questão não precisa de imagem. Deseja gerar mesmo assim?',
    })
  }

  const query = parsed.data.query?.trim() || question.imageQuery?.trim() ||
    `${exam.subject}: ${question.bnccSummary ?? question.statement.slice(0, 220)}. Ilustração didática sem texto.`

  try {
    const questionContext = [question.supportText, question.statement, question.alternatives?.map((a) => `${a.letter}) ${a.text}`).join('\n')].filter(Boolean).join('\n')
    const resolved = await resolveQuestionImage(query, questionContext, parsed.data.expectedText)
    if (!resolved) {
      return NextResponse.json({ error: 'Não foi possível encontrar nem gerar uma imagem para essa busca.' }, { status: 502 })
    }

    if (question.image) {
      question.imageHistory = [...(question.imageHistory ?? []), { ...question.image, replacedAt: new Date().toISOString() }]
    }
    question.needsImage = true
    question.imageQuery = query
    // Uma imagem pedida manualmente pelo revisor já é, por definição, uma
    // escolha humana — mas ainda passa pelo mesmo par aprovar/rejeitar da
    // tela de revisão antes de ir pro documento final (nunca aprovado
    // automaticamente só por ter sido encontrada/gerada).
    question.image = { ...resolved, approved: false }

    await db.update(generatedExams).set({ generationPayload: payload }).where(eq(generatedExams.id, examId))

    return NextResponse.json({ ok: true, image: question.image })
  } catch (err) {
    console.error('[exams/request-image] erro:', err)
    return NextResponse.json({ error: 'Erro ao buscar/gerar imagem.' }, { status: 502 })
  }
}
