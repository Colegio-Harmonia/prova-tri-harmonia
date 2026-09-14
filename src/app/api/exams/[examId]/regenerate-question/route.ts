import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { auth } from '@/auth/auth'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { buildSingleQuestionPrompt } from '@/lib/gemini/promptBuilder'
import {
  singleQuestionResultSchema,
  SINGLE_QUESTION_RESPONSE_SCHEMA,
  type ExamGenerationResult,
  type ExamQuestion,
  type SingleQuestionResult,
} from '@/lib/gemini/examSchema'
import { correctSingleQuestion } from '@/lib/gemini/examValidator'
import { resolveQuestionImage } from '@/lib/images/questionImageService'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { persistGeneratedQuestionClassifications } from '@/lib/pedagogical/generatedQuestionClassificationService'
import { generateValidatedStructuredContent, StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import { aiFailureResponse } from '@/lib/ai/routeFailure'
import { runQuestionQualityTest } from '@/lib/exams/questionQualityTest'
import {
  REPLACEMENT_STRATEGIES,
  findExcludedTopicsInQuestion,
  normalizeExcludedTopics,
  type ReplacementRequest,
} from '@/lib/gemini/replacementPolicy'

const bodySchema = z.object({
  questionNumber: z.number().int(),
  reviewFeedback: z.string().nullable().optional(),
  replacement: z.object({
    strategy: z.enum(REPLACEMENT_STRATEGIES),
    excludedTopics: z.array(z.string().trim().min(3).max(120)).max(8).default([]),
  }).optional(),
})

// Mesmas séries de status em que toggle-image permite edição — a troca de
// questão é uma ação de revisão, então segue a mesma janela (antes da
// prova ser aprovada pela coordenação).
const EDITABLE_STATUSES = ['rascunho', 'atribuido', 'em_andamento', 'revisao_concluida']

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
  if (!EDITABLE_STATUSES.includes(exam.status)) {
    return NextResponse.json({ error: 'Só é possível trocar questões antes da prova ser aprovada.' }, { status: 409 })
  }

  const payload = exam.generationPayload as ExamGenerationResult
  const index = payload.questions.findIndex((q) => q.number === parsed.data.questionNumber)
  if (index === -1) return NextResponse.json({ error: 'Questão não encontrada.' }, { status: 404 })

  const original = payload.questions[index]
  if (original.source === 'enem_bank') {
    return NextResponse.json({ error: 'Questões reais do banco ENEM não são geradas por IA — troque a seleção na tela de geração da prova.' }, { status: 400 })
  }

  try {
    const curriculum = await getCurriculumForExam({
      segment: exam.segment,
      gradeYear: exam.gradeYear,
      subject: exam.subject,
      bimester: exam.bimester ?? undefined,
    })
    const replacement: ReplacementRequest | undefined = parsed.data.replacement
      ? {
          strategy: parsed.data.replacement.strategy,
          excludedTopics: normalizeExcludedTopics(parsed.data.replacement.excludedTopics),
        }
      : undefined

    const prompt = await buildSingleQuestionPrompt(curriculum, {
      type: original.type,
      questionNumber: original.number,
      avoidStatement: original.statement,
      reviewFeedback: parsed.data.reviewFeedback,
      replacement,
    })

    const generated = await generateValidatedStructuredContent<SingleQuestionResult, ExamQuestion>({
      context: 'exams/regenerate-question',
      prompt,
      responseSchema: SINGLE_QUESTION_RESPONSE_SCHEMA,
      zodSchema: singleQuestionResultSchema,
      validate: async (parsedQuestion) => {
        // O número é identidade do item no payload. Não deixamos uma resposta
        // de substituição com número provisório chegar à revisão cega, que
        // exige uma numeração positiva e auditável.
        const generatedQuestion = { ...parsedQuestion.question, number: original.number }
        const { question, issues, warnings } = correctSingleQuestion(generatedQuestion, curriculum)
        const quality = await runQuestionQualityTest(curriculum, [question])
        issues.push(...quality.issues.filter((issue) => issue.severity === 'bloqueante').map((issue) => issue.reason))
        warnings.push(...quality.warnings)
        if (original.type === 'objetiva' && question.type !== 'objetiva') issues.push(`Esperado tipo "objetiva", veio "${question.type}".`)
        if (original.type === 'descritiva' && question.type !== 'descritiva') issues.push(`Esperado tipo "descritiva", veio "${question.type}".`)
        if (replacement?.excludedTopics.length) {
          const foundExcludedTopics = findExcludedTopicsInQuestion(question, replacement.excludedTopics)
          if (foundExcludedTopics.length) {
            issues.push(`A questão ainda contém o(s) tópico(s) que deveriam ser excluídos: ${foundExcludedTopics.join(', ')}.`)
          }
        }
        return { value: question, issues, warnings }
      },
    })

    if (generated.repaired) generated.warnings.push(`Resposta da IA validada após reparo (${generated.attempts} tentativa(s)).`)

    let question = { ...generated.value, number: original.number, review: null }

    if (question.needsImage) {
      let resolved = null
      if (question.imageQuery) {
        for (let attempt = 1; attempt <= 2 && !resolved; attempt++) {
          resolved = await resolveQuestionImage(question.imageQuery, question.statement)
        }
      }
      // A indisponibilidade visual não descarta uma questão válida. O
      // revisor pode solicitar a imagem novamente na própria tela.
      if (resolved) question = { ...question, image: { ...resolved, approved: false } }
    }

    const newQuestions = [...payload.questions]
    newQuestions[index] = question
    const newPayload: ExamGenerationResult = { ...payload, questions: newQuestions }

    await db.update(generatedExams).set({ generationPayload: newPayload }).where(eq(generatedExams.id, examId))

    let pedagogicalClassificationsCreated = 0
    try {
      const pedagogical = await persistGeneratedQuestionClassifications({
        examId,
        questions: [question],
        createdBy: authResult.currentUser.id,
        replaceExisting: true,
        modelProvider: 'deepseek',
        modelName: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
        promptVersion: 'single-question-pedagogical-v1',
      })
      pedagogicalClassificationsCreated = pedagogical.created.length
    } catch (classificationError) {
      console.error('[exams/regenerate-question] erro ao persistir classificações pedagógicas:', classificationError)
      generated.warnings.push('Questão trocada, mas houve erro ao persistir classificações pedagógicas estruturadas.')
    }

    return NextResponse.json({ ok: true, question, warnings: generated.warnings, pedagogicalClassificationsCreated })
  } catch (err) {
    if (err instanceof StructuredGenerationError) {
      return aiFailureResponse(err, 'A IA não retornou uma questão válida após as tentativas de reparo.')
    }
    console.error('[exams/regenerate-question] erro:', err)
    return aiFailureResponse(err, 'Erro ao gerar questão de substituição.')
  }
}
