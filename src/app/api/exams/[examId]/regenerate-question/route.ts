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
import { mergeQualityResults } from '@/lib/exams/qualityReport'
import { generateStagedQuestion, isStagedGenerationEnabled } from '@/lib/generation'
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
// `em_revisao` é o estado formal da revisão; sem ele a tela mostrava o
// botão "Recusar e gerar nova" mas o servidor recusava com 409.
const EDITABLE_STATUSES = ['rascunho', 'atribuido', 'em_andamento', 'revisao_concluida', 'em_revisao']

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

    const warnings: string[] = []
    let question: ExamQuestion | null = null

    // Pipeline fragmentado (fases 1–2) quando ligado: gera a substituição em
    // estágios com gates determinísticos. Falha é isolada — cai no fluxo
    // monolítico logo abaixo, sem derrubar a troca.
    if (isStagedGenerationEnabled()) {
      try {
        const staged = await generateStagedQuestion({
          questionNumber: original.number,
          subject: exam.subject,
          gradeYear: exam.gradeYear,
          segment: exam.segment,
          curriculumContent: curriculum.units.map((unit) => `${unit.tituloCapitulo} ${unit.conteudo ?? ''}`).join('\n').slice(0, 6000),
          contentPlanInstruction: [
            `substituir a questão ${original.number}; tipo ${original.type}`,
            parsed.data.reviewFeedback ? `feedback do revisor: ${parsed.data.reviewFeedback}` : null,
            replacement?.excludedTopics.length ? `excluir tópicos: ${replacement.excludedTopics.join(', ')}` : null,
          ].filter(Boolean).join('; '),
          questionType: original.type,
        })
        question = { ...staged.question, number: original.number, review: null }
        warnings.push(`Questão ${original.number}: gerada pelo pipeline fragmentado.`)
        warnings.push(...staged.issues.map((issue) => `[${issue.severity}] ${issue.reason}`))
      } catch (error) {
        warnings.push(`Pipeline fragmentado falhou (${error instanceof Error ? error.message : 'erro'}); usando o fluxo padrão.`)
      }
    }

    if (!question) {
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
          const { question: corrected, issues, warnings: questionWarnings } = correctSingleQuestion(generatedQuestion, curriculum)
          const quality = await runQuestionQualityTest(curriculum, [corrected])
          issues.push(...quality.issues.filter((issue) => issue.severity === 'bloqueante').map((issue) => issue.reason))
          questionWarnings.push(...quality.warnings)
          if (original.type === 'objetiva' && corrected.type !== 'objetiva') issues.push(`Esperado tipo "objetiva", veio "${corrected.type}".`)
          if (original.type === 'descritiva' && corrected.type !== 'descritiva') issues.push(`Esperado tipo "descritiva", veio "${corrected.type}".`)
          if (replacement?.excludedTopics.length) {
            const foundExcludedTopics = findExcludedTopicsInQuestion(corrected, replacement.excludedTopics)
            if (foundExcludedTopics.length) {
              issues.push(`A questão ainda contém o(s) tópico(s) que deveriam ser excluídos: ${foundExcludedTopics.join(', ')}.`)
            }
          }
          return { value: corrected, issues, warnings: questionWarnings }
        },
      })

      if (generated.repaired) warnings.push(`Resposta da IA validada após reparo (${generated.attempts} tentativa(s)).`)
      warnings.push(...generated.warnings)
      question = { ...generated.value, number: original.number, review: null }
    }

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

    // Reaudita a questão final: a auditoria dentro do validate serve para o
    // reparo, mas o relatório persistido precisa refletir o item que ficou na
    // prova. Sem isso ele ficava "fantasma" (auditava o item antigo) e a
    // barreira de aprovação bloqueava a prova já corrigida.
    const replacementQuality = await runQuestionQualityTest(curriculum, [question])
    const qualityResult = replacementQuality.report.find((item) => item.questionNumber === question.number)
    const newQuestions = [...payload.questions]
    newQuestions[index] = question
    const newPayload: ExamGenerationResult = qualityResult
      ? mergeQualityResults({
          payload: { ...payload, questions: newQuestions },
          updates: [{ questionNumber: question.number, result: qualityResult }],
          warnings: replacementQuality.warnings,
          phase: 'Auditoria da questão substituída',
        })
      : { ...payload, questions: newQuestions }

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
      warnings.push('Questão trocada, mas houve erro ao persistir classificações pedagógicas estruturadas.')
    }

    return NextResponse.json({ ok: true, question, warnings, pedagogicalClassificationsCreated })
  } catch (err) {
    if (err instanceof StructuredGenerationError) {
      return aiFailureResponse(err, 'A IA não retornou uma questão válida após as tentativas de reparo.')
    }
    console.error('[exams/regenerate-question] erro:', err)
    return aiFailureResponse(err, 'Erro ao gerar questão de substituição.')
  }
}
