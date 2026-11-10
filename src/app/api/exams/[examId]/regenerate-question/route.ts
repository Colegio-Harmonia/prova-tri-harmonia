import { classifyExamQuestions } from '@/lib/exams/questionClassification'
import { classifyImportedQuestionBloom } from '@/lib/exams/importedQuestionBloom'
import { acervoIdentity } from '@/lib/exams/questionOrigin'
import { findAcervoQuestion, AcervoUnavailableError } from '@/lib/exams/acervoQuestions'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams, generationJobs } from '@/db/schema'
import { auth } from '@/auth/auth'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { planIdFromExamPayload, planVersionIdFromExamPayload } from '@/lib/curriculum/planCurriculum'
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
import { assignExamPercentageWeights, classifyExamDifficulty } from '@/lib/exams/wholeExamGeneration'
import { coherenceIssues } from '@/lib/generation/coherence'
import { reviewExamVisuals } from '@/lib/exams/examVisualReview'
import { extractEnemCode } from '@/lib/sheets/enemSkillsParser'
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
  sourcePreference: z.enum(['auto', 'acervo', 'ia']).optional().default('auto'),
})

// Mesmas séries de status em que toggle-image permite edição — a troca de
// questão é uma ação de revisão, então segue a mesma janela (antes da
// prova ser aprovada pela coordenação).
// `em_revisao` é o estado formal da revisão; sem ele a tela mostrava o
// botão "Recusar e gerar nova" mas o servidor recusava com 409.
class ConcurrentExamChangeError extends Error {}

const EDITABLE_STATUSES = ['rascunho', 'atribuido', 'em_andamento', 'revisao_concluida', 'em_revisao']

async function replaceWholeExamQuestion(params: {
  examId: number
  requestedBy: number
  exam: typeof generatedExams.$inferSelect
  payload: ExamGenerationResult
  questionIndex: number
  original: ExamQuestion
  curriculum: Awaited<ReturnType<typeof getCurriculumForExam>>
  replacement?: ReplacementRequest
  reviewFeedback?: string | null
  sourcePreference: 'auto' | 'acervo' | 'ia'
}) {
  const { exam, payload, original, curriculum } = params
  const peerContext = payload.questions
    .filter((question) => question.number !== original.number)
    .map((question) => `Questão ${question.number} (${question.type}, ${question.bloomLevel}, BNCC ${question.bnccCodes.join(', ') || 'sem código'}): ${question.statement}`)
    .join('\n')
  const generated = await generateQuestionWithUnifiedFlow({
    curriculum,
    unit: curriculum.units.find((unit) => unit.rowIndex === original.curriculumUnitRowIndex),
    sourcePreference: params.sourcePreference,
    excludedQuestions: payload.questions,
    acervoHistory: payload.metadata.acervoHistory,
    questionNumber: original.number,
    type: original.type,
    classLabel: payload.metadata.classLabel,
    targetSkillCodes: original.bnccStatus === 'mapeado' && params.replacement?.strategy !== 'outro_tema_planejamento' ? original.bnccCodes : undefined,
    targetEnemCode: params.replacement?.strategy !== 'outro_tema_planejamento' ? original.plannedEnemSkill?.code ?? undefined : undefined,
    skipJevVisualDecision: true,
    statementContext: [
      'Substitua somente a questão indicada. Considere as outras questões para evitar repetir contexto, enunciado, tarefa cognitiva e para não fornecer respostas entre itens.',
      `Questões que permanecerão na prova:\n${peerContext}`,
      params.reviewFeedback ? `Feedback do revisor: ${params.reviewFeedback}` : null,
      params.replacement?.excludedTopics.length ? `Tópicos a excluir: ${params.replacement.excludedTopics.join(', ')}` : null,
    ].filter(Boolean).join('\n\n'),
    instruction: [
      `substituir a questão ${original.number}; tipo ${original.type}`,
      `não repetir as questões existentes: ${peerContext}`,
      params.reviewFeedback ? `feedback do revisor: ${params.reviewFeedback}` : null,
      params.replacement?.excludedTopics.length ? `excluir tópicos: ${params.replacement.excludedTopics.join(', ')}` : null,
    ].filter(Boolean).join('; '),
  })
  const rawImageNeed = Boolean(generated.question.needsImage || generated.question.visualPlan?.required)
  const imageDescription = rawImageNeed
    ? generated.question.imageDescription ?? generated.question.imageQuery ?? generated.question.visualPlan?.rationale ?? null
    : null
  const replacement: ExamQuestion = {
    ...generated.question,
    number: original.number,
    slotId: original.slotId ?? `q${String(original.number).padStart(2, '0')}`,
    source: generated.question.source,
    type: generated.question.type,
    weight: original.weight,
    bloomLevel: generated.question.bloomLevel,
    bnccCodes: original.bnccCodes,
    bnccStatus: original.bnccStatus,
    bnccSummary: original.bnccSummary,
    bnccDetails: original.bnccDetails,
    curriculumUnitRowIndex: original.curriculumUnitRowIndex,
    curriculumSnapshot: original.curriculumSnapshot,
    generationContext: original.generationContext ? {
      ...original.generationContext,
      alternativesCount: generated.question.type === 'objetiva' ? generated.question.alternatives?.length ?? 0 : 0,
    } : generated.question.generationContext,
    hasImage: rawImageNeed,
    imageDescription,
    needsImage: rawImageNeed,
    imageQuery: imageDescription,
    image: generated.question.image ?? null,
    review: null,
  }
  const newQuestions = [...payload.questions]
  const visualReview = await reviewExamVisuals([replacement], { subject: exam.subject, segment: payload.metadata.segment, gradeYear: payload.metadata.gradeYear })
  generated.warnings.push(...visualReview.warnings)
  const [classifiedReplacement] = await classifyExamQuestions(visualReview.questions, curriculum)
  newQuestions[params.questionIndex] = classifiedReplacement!
  const blockingOverlap = coherenceIssues(newQuestions).filter((issue) => issue.severity === 'bloqueante')
  if (blockingOverlap.length) {
    throw new Error(`A questão substituta repete ou entrega conteúdo de outra questão. ${blockingOverlap.map((issue) => issue.reason).join(' ')}`)
  }

  const educationContext = payload.metadata.segment === 'ensino-medio'
    ? `Ensino Médio ${payload.metadata.gradeYear}º ano do ensino brasileiro`
    : `${payload.metadata.gradeYear}º ano do Ensino Fundamental, ${payload.metadata.segment === 'anos-iniciais' ? 'Anos Iniciais' : 'Anos Finais'}, do ensino brasileiro`
  const difficulty = await classifyExamDifficulty(newQuestions, educationContext, exam.subject)
  if (difficulty.source === 'fallback') generated.warnings.push('O Jev não respondeu à classificação de dificuldade; a prova recebeu dificuldade média provisória e pesos iguais até revisão.')
  const weightedQuestions = assignExamPercentageWeights(difficulty.questions)
  const pendingQuestionNumbers = weightedQuestions
    .filter((question) => Boolean(question.needsImage ?? question.hasImage) && !question.image)
    .map((question) => question.number)
  const imageUpdatedAt = new Date().toISOString()
  const withoutOldQuality = { ...payload.metadata }
  delete withoutOldQuality.qualityTest
  const basePayload: ExamGenerationResult = {
    ...payload,
    metadata: {
      ...withoutOldQuality,
      objectiveCount: weightedQuestions.filter((question) => question.type === 'objetiva').length,
      discursiveCount: weightedQuestions.filter((question) => question.type === 'descritiva').length,
      acervoHistory: [...(payload.metadata.acervoHistory ?? []), ...[original, replacement].flatMap((q) => { const key = acervoIdentity(q); return key ? [{ key, statement: q.statement, questionId: q.acervoRef!.questionId }] : [] })],
      difficultyClassification: {
        version: 'jev-difficulty-v1',
        source: difficulty.source,
        model: difficulty.model,
        classifiedAt: difficulty.classifiedAt,
        distribution: difficulty.distribution,
        weightBasis: 'difficulty_normalized_to_100',
      },
      imageGeneration: {
        status: pendingQuestionNumbers.length ? 'pending' : 'complete',
        jobId: null,
        pendingQuestionNumbers,
        updatedAt: imageUpdatedAt,
      },
    },
    questions: weightedQuestions,
  }

  let savedPayload = basePayload
  await db.transaction(async (tx) => {
    let imageJobId: number | null = null
    if (pendingQuestionNumbers.length) {
      const [imageJob] = await tx.insert(generationJobs).values({
        jobType: 'gerar_imagens_prova',
        payload: { examId: params.examId },
        requestedBy: params.requestedBy,
        priority: 6,
      }).returning({ id: generationJobs.id })
      imageJobId = imageJob!.id
      generated.warnings.push('A questão foi salva. As imagens pendentes serão produzidas em segundo plano.')
    }
    savedPayload = {
      ...basePayload,
      metadata: {
        ...basePayload.metadata,
        imageGeneration: { ...basePayload.metadata.imageGeneration!, jobId: imageJobId },
      },
    }
    const updated = await tx.update(generatedExams).set({
      generationPayload: savedPayload,
      objectiveCount: savedPayload.metadata.objectiveCount,
      discursiveCount: savedPayload.metadata.discursiveCount,
      unmappedWarnings: [...(Array.isArray(exam.unmappedWarnings) ? exam.unmappedWarnings as string[] : []), ...generated.warnings],
    }).where(and(eq(generatedExams.id, params.examId), eq(generatedExams.status, exam.status), sql`${generatedExams.generationPayload} = ${JSON.stringify(exam.generationPayload)}::jsonb`)).returning({ id: generatedExams.id })
    if (!updated.length) throw new ConcurrentExamChangeError('A prova mudou durante a busca. Atualize a revisão e tente novamente.')
  })

  const pedagogical = await persistGeneratedQuestionClassifications({
    examId: params.examId,
    questions: [replacement],
    createdBy: params.requestedBy,
    replaceExisting: true,
    modelProvider: 'whole-exam',
    modelName: 'whole-exam-v1',
    promptVersion: 'whole-exam-v1',
  })
  return { question: savedPayload.questions[params.questionIndex], warnings: generated.warnings, pedagogicalClassificationsCreated: pedagogical.created.length }
}

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
      academicYear: exam.academicYear,
      subject: exam.subject,
      bimester: exam.bimester ?? undefined,
      curriculumPlanId: planIdFromExamPayload(exam.generationPayload),
      curriculumPlanVersionId: planVersionIdFromExamPayload(exam.generationPayload),
    })
    const replacement: ReplacementRequest | undefined = parsed.data.replacement
      ? {
          strategy: parsed.data.replacement.strategy,
          excludedTopics: normalizeExcludedTopics(parsed.data.replacement.excludedTopics),
        }
      : undefined

    const warnings: string[] = []
    let question: ExamQuestion | null = null

    if (payload.metadata.generationEngine === 'whole-exam-v1') {
      if (parsed.data.repairOnly) {
        return NextResponse.json({ error: 'O fluxo de prova inteira não executa reparo por diagnóstico do Jev. Use a substituição da questão; o Jev classifica dificuldade, Bloom e a matriz INEP.' }, { status: 409 })
      }
      const result = await replaceWholeExamQuestion({
        examId,
        requestedBy: authResult.currentUser.id,
        exam,
        payload,
        questionIndex: index,
        original,
        curriculum,
        replacement,
        reviewFeedback: parsed.data.reviewFeedback,
        sourcePreference: parsed.data.sourcePreference,
      })
      return NextResponse.json({ ok: true, ...result })
    }

    if (!parsed.data.repairOnly && parsed.data.sourcePreference === 'acervo') {
      const found = await findAcervoQuestion({ codes: original.bnccCodes, number: original.number, type: original.type, excludedQuestions: payload.questions, history: payload.metadata.acervoHistory })
      if (!found.question) return NextResponse.json({ error: found.reason }, { status: 422 })
      const [classified] = await classifyImportedQuestionBloom([found.question], curriculum)
      question = { ...classified!, weight: original.weight, curriculumUnitRowIndex: original.curriculumUnitRowIndex }
    }

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
        classLabel: payload.metadata.classLabel,
      })
      if (repaired && JSON.stringify(repaired.question) !== JSON.stringify(original)) {
        question = repaired.question
        warnings.push(`Questão ${original.number}: reparo local aplicado a partir do diagnóstico de qualidade.`)
        warnings.push(...repaired.warnings)
      } else {
        return NextResponse.json({ error: `O reparo orientado pelo Jev não produziu uma questão corrigida. Diagnóstico: ${diagnostics.filter((item) => item.blocksApproval).map((item) => item.message).join('; ')}` }, { status: 422 })
      }
    }

    if (!question) {
      let lastGenerationError: unknown
      for (let attempt = 1; attempt <= MAX_FULL_QUESTION_GENERATION_ATTEMPTS && !question; attempt++) {
        try {
          const generated = await generateQuestionWithUnifiedFlow({
            curriculum,
            unit: curriculum.units.find((unit) => unit.rowIndex === original.curriculumUnitRowIndex),
            sourcePreference: parsed.data.sourcePreference,
            excludedQuestions: payload.questions,
            acervoHistory: payload.metadata.acervoHistory,
            questionNumber: original.number,
            type: original.type,
            classLabel: payload.metadata.classLabel,
            targetSkillCodes: original.bnccStatus === 'mapeado' && replacement?.strategy !== 'outro_tema_planejamento' ? original.bnccCodes : undefined,
            targetEnemCode: replacement?.strategy !== 'outro_tema_planejamento' ? original.plannedEnemSkill?.code ?? (original.saeb?.source === 'enem' ? extractEnemCode(original.saeb.value)?.code : undefined) : undefined,
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

    if (question.source === 'ia' && question.needsImage) {
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
    if (!question) throw new Error('A geração não retornou uma questão de substituição.')
    let auditedQuestion: ExamQuestion = question
    let replacementQuality = await runQuestionQualityTest(curriculum, [auditedQuestion], new Map(), payload.metadata.classLabel)
    let qualityResult = replacementQuality.report.find((item) => item.questionNumber === auditedQuestion.number)
    for (let round = 1; round <= 2 && qualityResult && !qualityResult.approved && auditedQuestion.source === 'ia'; round++) {
      const diagnostics = (qualityResult.diagnostics ?? []) as import('@/lib/exams/qualityDiagnostics').QualityDiagnostic[]
      if (!diagnostics.some((item) => item.blocksApproval && (item.repairAction === 'reparo_local' || item.repairAction === 'regenerar_questao'))) {
        return NextResponse.json({ error: 'O Jev não retornou uma correção acionável; a questão não foi salva sem parecer final.' }, { status: 422 })
      }
      const before = JSON.stringify(auditedQuestion)
      const repaired = await repairQuestionFromDiagnostics({
        question: auditedQuestion,
        curriculum,
        diagnostics,
        context: `exams/manual-replacement-quality-repair-${auditedQuestion.number}-${round}`,
        classLabel: payload.metadata.classLabel,
      })
      if (!repaired || JSON.stringify(repaired.question) === before) {
        return NextResponse.json({ error: `A correção Jev não alterou o defeito apontado. ${diagnostics.filter((item) => item.blocksApproval).map((item) => item.message).join('; ')}` }, { status: 422 })
      }
      auditedQuestion = repaired.question
      warnings.push(...repaired.warnings)
      replacementQuality = await runQuestionQualityTest(curriculum, [auditedQuestion], new Map(), payload.metadata.classLabel)
      qualityResult = replacementQuality.report.find((item) => item.questionNumber === auditedQuestion.number)
    }
    if (!qualityResult?.approved) {
      return NextResponse.json({ error: `A questão não foi substituída porque continua sem aprovação do Jev. ${qualityResult?.diagnostics?.map((item) => item.message).join('; ') ?? ''}` }, { status: 422 })
    }
    const [classifiedQuestion] = await classifyExamQuestions([auditedQuestion], curriculum)
    question = classifiedQuestion!
    const newQuestions = [...payload.questions]
    newQuestions[index] = question
    const replacementMetadata = {
      ...payload.metadata,
      objectiveCount: newQuestions.filter((item) => item.type === 'objetiva').length,
      discursiveCount: newQuestions.filter((item) => item.type === 'descritiva').length,
      acervoHistory: [...(payload.metadata.acervoHistory ?? []), ...[original, question].flatMap((q) => { const key = acervoIdentity(q); return key ? [{ key, statement: q.statement, questionId: q.acervoRef!.questionId }] : [] })],
    }
    const newPayload: ExamGenerationResult = qualityResult
      ? mergeQualityResults({
          payload: { ...payload, metadata: replacementMetadata, questions: newQuestions },
          updates: [{ questionNumber: question.number, result: qualityResult }],
          warnings: replacementQuality.warnings,
          phase: 'Auditoria da questão substituída',
        })
      : { ...payload, metadata: replacementMetadata, questions: newQuestions }

    const updated = await db.update(generatedExams).set({
      generationPayload: newPayload,
      objectiveCount: newPayload.metadata.objectiveCount,
      discursiveCount: newPayload.metadata.discursiveCount,
    }).where(and(eq(generatedExams.id, examId), eq(generatedExams.status, exam.status), sql`${generatedExams.generationPayload} = ${JSON.stringify(exam.generationPayload)}::jsonb`)).returning({ id: generatedExams.id })
    if (!updated.length) throw new ConcurrentExamChangeError('A prova mudou durante a busca. Atualize a revisão e tente novamente.')

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
    if (err instanceof AcervoUnavailableError) return NextResponse.json({ error: err.message }, { status: 422 })
    if (err instanceof ConcurrentExamChangeError) return NextResponse.json({ error: err.message }, { status: 409 })
    console.error('[exams/regenerate-question] erro:', err)
    return aiFailureResponse(err, 'Erro ao gerar questão de substituição.')
  }
}
