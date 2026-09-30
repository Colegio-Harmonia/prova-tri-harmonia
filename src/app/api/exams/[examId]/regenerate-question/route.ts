import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { auth } from '@/auth/auth'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import {
  type ExamGenerationResult,
  type ExamQuestion,
} from '@/lib/gemini/examSchema'
import { resolveQuestionImage } from '@/lib/images/questionImageService'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { persistGeneratedQuestionClassifications } from '@/lib/pedagogical/generatedQuestionClassificationService'
import { StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import { aiFailureResponse } from '@/lib/ai/routeFailure'
import { runQuestionQualityTest } from '@/lib/exams/questionQualityTest'
import { mergeQualityResults } from '@/lib/exams/qualityReport'
import { diagnosticsForQuestion } from '@/lib/exams/qualityDiagnostics'
import { repairQuestionFromDiagnostics } from '@/lib/exams/repairQuestion'
import { generateQuestionWithUnifiedFlow } from '@/lib/exams/unifiedQuestionGeneration'
import {
  MAX_FULL_QUESTION_GENERATION_ATTEMPTS,
  shouldRetryQuestionGeneration,
} from '@/lib/exams/regenerationRetry'
import {
  REPLACEMENT_STRATEGIES,
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
  repairOnly: z.boolean().optional().default(false),
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

    // Reparo local é acionado somente pela revisão e só para diagnósticos
    // declaradamente reparáveis. Se não houver plano local, não fingimos que
    // uma regeneração ampla é uma correção: devolvemos uma mensagem clara.
    if (parsed.data.repairOnly) {
      const diagnostics = diagnosticsForQuestion(payload, original.number)
      const repaired = await repairQuestionFromDiagnostics({
        question: original,
        curriculum,
        diagnostics,
        context: `exams/manual-quality-repair-${original.number}`,
      })
      if (!repaired) {
        return NextResponse.json({ error: 'Esta questão não possui um reparo local seguro. Use “Recusar e gerar nova” ou faça a revisão humana indicada.' }, { status: 422 })
      }
      question = repaired.question
      warnings.push(`Questão ${original.number}: reparo local aplicado a partir do diagnóstico de qualidade.`)
      warnings.push(...repaired.warnings)
    }

    if (!question) {
      let lastGenerationError: unknown
      for (let attempt = 1; attempt <= MAX_FULL_QUESTION_GENERATION_ATTEMPTS && !question; attempt++) {
        try {
          const generated = await generateQuestionWithUnifiedFlow({
            curriculum,
            questionNumber: original.number,
            type: original.type,
            instruction: [
              `substituir a questão ${original.number}; tipo ${original.type}`,
              attempt > 1 ? 'a tentativa anterior não gerou um JSON válido; gere uma nova questão completa, autocontida e conforme o contrato' : null,
              parsed.data.reviewFeedback ? `feedback do revisor: ${parsed.data.reviewFeedback}` : null,
              replacement?.excludedTopics.length ? `excluir tópicos: ${replacement.excludedTopics.join(', ')}` : null,
            ].filter(Boolean).join('; '),
          })
          question = generated.question
          warnings.push(...generated.warnings)
          if (attempt > 1) warnings.push(`Questão ${original.number}: gerada na ${attempt}ª tentativa completa após uma resposta inválida da IA.`)
        } catch (error) {
          lastGenerationError = error
          if (!shouldRetryQuestionGeneration(error) || attempt === MAX_FULL_QUESTION_GENERATION_ATTEMPTS) throw error
          console.warn('[exams/regenerate-question] repetindo geração completa após falha estruturada:', {
            questionNumber: original.number,
            attempt,
            failureCode: error.failureCode,
          })
        }
      }
      if (!question) throw lastGenerationError ?? new Error('A geração não retornou uma questão.')
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
      return aiFailureResponse(err, 'A IA retornou uma resposta incompleta para esta substituição. Nenhuma alteração foi salva; tente novamente.')
    }
    console.error('[exams/regenerate-question] erro:', err)
    return aiFailureResponse(err, 'Erro ao gerar questão de substituição.')
  }
}
