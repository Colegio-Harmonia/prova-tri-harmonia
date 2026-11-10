import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import axios from 'axios'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { auth } from '@/auth/auth'
import { ImageValidationRejectedError, resolveQuestionImage, uploadToStaging } from '@/lib/images/questionImageService'
import { compactIllustrationBrief, generateIllustrationBrief } from '@/lib/images/illustrationBrief'
import { renderQuestionDataVisual } from '@/lib/illustrations/questionDataVisual'
import { AiBudgetExceededError } from '@/lib/ai/operationBudget'
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

  try {
    const questionContext = [question.supportText, question.statement, question.alternatives?.map((a) => `${a.letter}) ${a.text}`).join('\n')].filter(Boolean).join('\n')
    const dataVisual = !parsed.data.expectedText ? await renderQuestionDataVisual(exam.subject, question) : null
    // Provas anteriores ainda não possuem whatIfImage. Criamos e guardamos o
    // briefing uma vez, sem voltar a usar o enunciado bruto como prompt.
    const hadWhatIfImage = Boolean(question.whatIfImage?.trim())
    const explicitQuery = parsed.data.query?.trim()
    // Pedido manual não depende de uma chamada adicional de IA. O contexto
    // informado pelo professor basta para buscar ou gerar a imagem, em
    // qualquer disciplina ou tipo de questão.
    const whatIfImage = dataVisual ? null : question.whatIfImage?.trim()
      || explicitQuery
      || await generateIllustrationBrief({ subject: exam.subject, statement: question.statement, supportText: question.supportText })
    const brief = whatIfImage ? compactIllustrationBrief(whatIfImage) : null
    if (!hadWhatIfImage && brief) {
      question.whatIfImage = brief
      await db.update(generatedExams).set({ generationPayload: payload }).where(eq(generatedExams.id, examId))
    }
    const query = dataVisual
      ? dataVisual.kind === 'grid' ? 'Malha quadriculada com os quadradinhos descritos no enunciado'
        : dataVisual.kind === 'polygon' ? 'Polígono desenhado com os vértices descritos no enunciado'
          : 'Gráfico das leituras de temperatura descritas no enunciado'
      : parsed.data.query?.trim() || brief || 'Ilustração didática'
    const resolved = dataVisual
      ? { ...(await uploadToStaging(dataVisual.buffer, 'image/png', `questao-${question.number}-${dataVisual.kind}-${Date.now()}.png`)), source: dataVisual.kind === 'grid' ? 'diagrama' as const : 'grafico' as const }
      : await resolveQuestionImage(query, questionContext, parsed.data.expectedText, { reportFailure: true })
    if (!resolved) {
      return NextResponse.json({ error: 'Não foi possível encontrar nem gerar uma imagem para essa busca.' }, { status: 502 })
    }

    if (question.image) {
      question.imageHistory = [...(question.imageHistory ?? []), { ...question.image, replacedAt: new Date().toISOString(), changedBy: session.user.email }]
    }
    question.needsImage = true
    question.imageQuery = query
    if (brief) question.whatIfImage = brief
    // Uma imagem pedida manualmente pelo revisor já é, por definição, uma
    // escolha humana — mas ainda passa pelo mesmo par aprovar/rejeitar da
    // tela de revisão antes de ir pro documento final (nunca aprovado
    // automaticamente só por ter sido encontrada/gerada).
    question.image = { ...resolved, approved: false }
    question.imageAuditLog = [...(question.imageAuditLog ?? []), { action: question.imageHistory?.length ? 'replaced' : 'generated', at: new Date().toISOString(), actor: session.user.email, driveFileId: resolved.driveFileId }]

    await db.update(generatedExams).set({ generationPayload: payload }).where(eq(generatedExams.id, examId))

    return NextResponse.json({ ok: true, image: question.image })
  } catch (err) {
    if (err instanceof AiBudgetExceededError) {
      return NextResponse.json({ error: 'O limite diário de IA foi atingido. A ilustração poderá ser gerada após o próximo reset da cota.' }, { status: 429 })
    }
    console.error('[exams/request-image] erro:', err)
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: `A descrição da imagem veio em formato inválido (${err.issues.map((issue) => issue.path.join('.') || issue.message).join(', ')}). Tente novamente.`, stage: 'descricao' }, { status: 502 })
    }
    if (err instanceof ImageValidationRejectedError) {
      return NextResponse.json({ error: `A imagem foi criada, mas reprovada na conferência visual: ${err.reason.slice(0, 300)}`, stage: 'validacao_visual' }, { status: 502 })
    }
    if (axios.isAxiosError(err)) {
      const status = err.response?.status
      const requestId = err.response?.headers?.['x-request-id'] ?? err.response?.headers?.['request-id']
      return NextResponse.json({ error: `O provedor de imagem falhou${status ? ` (HTTP ${status})` : ' por conexão ou tempo limite'}${requestId ? `; solicitação ${String(requestId).slice(0, 100)}` : ''}. Tente novamente.`, stage: 'provedor', providerStatus: status ?? null }, { status: 502 })
    }
    const message = err instanceof Error ? err.message : ''
    if (/não configurad[oa]|perfil de imagem ativo|ative um perfil/i.test(message)) {
      return NextResponse.json({ error: message.slice(0, 300), stage: 'configuracao' }, { status: 502 })
    }
    if (/Drive|DRIVE_ROOT_FOLDER_ID|arquivo enviado|integridade/i.test(message)) {
      return NextResponse.json({ error: `Falha ao salvar a imagem no Drive: ${message.slice(0, 300)}`, stage: 'armazenamento' }, { status: 502 })
    }
    return NextResponse.json({ error: 'Falha ao gerar ou validar a imagem. Consulte o registro do servidor para o detalhe técnico.', stage: 'geracao' }, { status: 502 })
  }
}
