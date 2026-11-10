import { classifyImportedQuestionBloom } from '@/lib/exams/importedQuestionBloom'
import { acervoIdentity } from '@/lib/exams/questionOrigin'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams, generationJobs } from '@/db/schema'
import { auth } from '@/auth/auth'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { planIdFromExamPayload, planVersionIdFromExamPayload } from '@/lib/curriculum/planCurriculum'
import { computeQuestionSplit } from '@/lib/gemini/promptBuilder'
import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'
import { attachImagesToExam, RequiredQuestionImageError } from '@/lib/images/questionImageService'
import { buildBankExamQuestions } from '@/lib/gemini/enemBankMerge'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { persistGeneratedQuestionClassifications } from '@/lib/pedagogical/generatedQuestionClassificationService'
import { StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import { aiFailureResponse } from '@/lib/ai/routeFailure'
import { isPedagogicalQualityGateEnabled } from '@/lib/pedagogical/generationQualityGate'
import { runQuestionQualityTest } from '@/lib/exams/questionQualityTest'
import { QUALITY_REPORT_VERSION } from '@/lib/exams/qualityReport'
import { coherenceIssues, EXAM_OVERLAP_ALERT, EXAM_OVERLAP_BLOCK, questionCoherenceText, textSimilarity } from '@/lib/generation'
import { generateQuestionWithUnifiedFlow } from '@/lib/exams/unifiedQuestionGeneration'
import type { QualityDiagnostic } from '@/lib/exams/qualityDiagnostics'
import { repairQuestionFromDiagnostics } from '@/lib/exams/repairQuestion'
import { alternativesCountForSegment } from '@/lib/gemini/promptBuilder'
import { getOfficialBnccSkill } from '@/lib/curriculum/officialBncc'
import { cognitiveObjectives, pickTargetSkills } from '@/lib/exams/targetSkills'
import { reviewExamVisuals } from '@/lib/exams/examVisualReview'
import { assignExamPercentageWeights, classifyExamDifficulty, generateWholeExam, type WholeExamBlueprintSlot } from '@/lib/exams/wholeExamGeneration'
import { scoringMethodForQuestions } from '@/lib/scoring/scoringPolicy'

async function regenerateWholeExam(params: {
  examId: number
  requestedBy: number
  exam: typeof generatedExams.$inferSelect
  previous: ExamGenerationResult
  curriculum: Awaited<ReturnType<typeof getCurriculumForExam>>
}) {
  const { exam, previous, curriculum } = params
  const bankIds = exam.enemBankQuestionIds ?? []
  const aiCount = Math.max(0, exam.questionCount - bankIds.length)
  const priorAi = previous.questions.filter((question) => question.source !== 'enem_bank').sort((a, b) => a.number - b.number)
  const alternativesCount = alternativesCountForSegment(exam.segment)
  const aiObjectiveCount = priorAi.filter((question) => question.type === 'objetiva').length
  const bloomLevels = exam.segment === 'anos-iniciais'
    ? ['lembrar', 'compreender', 'aplicar'] as const
    : exam.segment === 'anos-finais'
      ? ['compreender', 'aplicar', 'analisar', 'avaliar'] as const
      : ['compreender', 'aplicar', 'analisar', 'avaliar', 'criar'] as const
  const perUnitOffset = new Map<number, number>()
  const slots: WholeExamBlueprintSlot[] = Array.from({ length: aiCount }, (_, index) => {
    const oldQuestion = priorAi[index]
    const rowIndex = oldQuestion?.curriculumUnitRowIndex
    const unit = curriculum.units.find((candidate) => candidate.rowIndex === rowIndex)
      ?? curriculum.units[index % Math.max(1, curriculum.units.length)]
    if (!unit) throw new Error(`Não há unidade curricular para recriar a questão ${index + 1}.`)
    const offset = perUnitOffset.get(unit.rowIndex) ?? 0
    perUnitOffset.set(unit.rowIndex, offset + 1)
    const questionType = oldQuestion?.type ?? (index < aiObjectiveCount ? 'objetiva' : 'descritiva')
    const visualAid = oldQuestion?.generationContext?.visualAid ?? 'auto'
    const targetSkills = oldQuestion?.bnccCodes.length
      ? oldQuestion.bnccCodes.map((code) => {
          const official = getOfficialBnccSkill(code)
          if (!official) throw new Error(`Habilidade ${code} sem cartão oficial completo em @bncc/dados.`)
          return official
        })
      : pickTargetSkills({ unit, slotIndexInUnit: offset }).map((skill) => {
          const official = getOfficialBnccSkill(skill.code)
          if (!official) throw new Error(`Habilidade ${skill.code} sem cartão oficial completo em @bncc/dados.`)
          return official
        })
    return {
      number: index + 1,
      unitRowIndex: unit.rowIndex,
      type: questionType,
      visualAid,
      targetBloomLevel: oldQuestion?.bloomLevel ?? bloomLevels[index % bloomLevels.length]!,
      targetSkills,
      unitTitle: unit.tituloCapitulo,
      curriculumContent: unit.conteudo,
      enrichedContent: unit.enrichedContent ?? null,
      objectives: oldQuestion?.curriculumSnapshot?.objectives ?? cognitiveObjectives(unit),
    }
  })

  const generated = aiCount
    ? await generateWholeExam({
        subject: exam.subject,
        segment: exam.segment,
        gradeYear: exam.gradeYear,
        academicYear: exam.academicYear,
        classLabel: previous.metadata.classLabel,
        bimester: exam.bimester ?? undefined,
        questionCount: aiCount,
        alternativesCount,
        objectiveCount: aiObjectiveCount,
        discursiveCount: aiCount - aiObjectiveCount,
        slots,
        questionSource: previous.metadata.questionSource,
        excludedQuestions: previous.questions,
        acervoHistory: previous.metadata.acervoHistory,
        generationInstruction: 'Regeneração solicitada pelo professor: crie uma nova prova completa, variada e autocontida, sem reaproveitar os enunciados anteriores.',
      })
    : { questions: [], blueprint: [] }
  const bankQuestions = await classifyImportedQuestionBloom(await buildBankExamQuestions(bankIds, aiCount + 1), exam)
  if (bankQuestions.length !== bankIds.length) throw new Error('Uma ou mais questões do banco ENEM não estão mais disponíveis. A prova anterior foi preservada.')
  const visualReview = await reviewExamVisuals(generated.questions, { subject: exam.subject, segment: exam.segment, gradeYear: exam.gradeYear })
  const allQuestions = [...visualReview.questions, ...bankQuestions]
  const educationContext = exam.segment === 'ensino-medio'
    ? `Ensino Médio ${exam.gradeYear}º ano do ensino brasileiro`
    : `${exam.gradeYear}º ano do Ensino Fundamental, ${exam.segment === 'anos-iniciais' ? 'Anos Iniciais' : 'Anos Finais'}, do ensino brasileiro`
  const difficulty = await classifyExamDifficulty(allQuestions, educationContext, exam.subject)
  const questions = assignExamPercentageWeights(difficulty.questions)
  const pendingQuestionNumbers = questions.filter((question) => Boolean(question.needsImage ?? question.hasImage) && !question.image).map((question) => question.number)
  const imageUpdatedAt = new Date().toISOString()
  const { qualityTest: _qualityTest, generationProgress: _generationProgress, ...preservedMetadata } = previous.metadata
  const payload: ExamGenerationResult = {
    ...previous,
    metadata: {
      ...preservedMetadata,
      generationEngine: 'whole-exam-v1',
      acervoHistory: [...(previous.metadata.acervoHistory ?? []), ...[...previous.questions, ...questions].flatMap((q) => { const key = acervoIdentity(q); return key ? [{ key, statement: q.statement, questionId: q.acervoRef!.questionId }] : [] })],
      academicYear: exam.academicYear,
      segment: exam.segment,
      gradeYear: exam.gradeYear,
      subject: exam.subject,
      ...(previous.metadata.classLabel ? { classLabel: previous.metadata.classLabel } : {}),
      bimester: exam.bimester ?? null,
      questionCount: questions.length,
      objectiveCount: questions.filter((question) => question.type === 'objetiva').length,
      discursiveCount: questions.filter((question) => question.type === 'descritiva').length,
      alternativesCount,
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
    questions,
  }
  const warnings = [...curriculum.unmappedWarnings, ...visualReview.warnings, ...questions.filter((q) => q.acervoFallbackReason).map((q) => `Questão ${q.number}: GERADO POR IA. ${q.acervoFallbackReason}`)]
  if (difficulty.source === 'fallback') warnings.push('O Jev não respondeu à classificação de dificuldade; as questões receberam dificuldade média provisória e pesos iguais até revisão.')
  if (pendingQuestionNumbers.length) warnings.push('A prova foi salva. A produção das imagens será executada em segundo plano.')
  let savedPayload = payload
  await db.transaction(async (tx) => {
    let imageJobId: number | null = null
    if (pendingQuestionNumbers.length) {
      const [job] = await tx.insert(generationJobs).values({
        jobType: 'gerar_imagens_prova',
        payload: { examId: params.examId },
        requestedBy: params.requestedBy,
        priority: 6,
      }).returning({ id: generationJobs.id })
      imageJobId = job!.id
    }
    savedPayload = {
      ...payload,
      metadata: { ...payload.metadata, imageGeneration: { ...payload.metadata.imageGeneration!, jobId: imageJobId } },
    }
    await tx.update(generatedExams).set({
      objectiveCount: savedPayload.metadata.objectiveCount,
      discursiveCount: savedPayload.metadata.discursiveCount,
      scoringMethod: scoringMethodForQuestions(questions),
      generationPayload: savedPayload,
      unmappedWarnings: warnings,
    }).where(eq(generatedExams.id, params.examId))
  })
  const pedagogical = await persistGeneratedQuestionClassifications({
    examId: params.examId,
    questions,
    createdBy: params.requestedBy,
    replaceExisting: true,
    modelProvider: 'whole-exam',
    modelName: 'whole-exam-v1',
    promptVersion: 'whole-exam-v1',
  })
  return { exam: savedPayload, warnings, issues: [], pedagogicalClassificationsCreated: pedagogical.created.length }
}

export async function POST(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const authResult = await authorizeExamAccess(examId, session.user.email)
  if ('error' in authResult) return authResult.error
  const { exam } = authResult
  const existingPayload = exam.generationPayload as ExamGenerationResult
  if (exam.status !== 'rascunho') {
    return NextResponse.json({ error: 'Só é possível regenerar provas em rascunho.' }, { status: 409 })
  }

  try {
    if (existingPayload.metadata.generationEngine === 'whole-exam-v1') {
      const curriculum = await getCurriculumForExam({
        segment: exam.segment,
        gradeYear: exam.gradeYear,
        academicYear: exam.academicYear,
        subject: exam.subject,
        bimester: exam.bimester ?? undefined,
        curriculumPlanId: planIdFromExamPayload(exam.generationPayload),
      curriculumPlanVersionId: planVersionIdFromExamPayload(exam.generationPayload),
      })
      const result = await regenerateWholeExam({
        examId,
        requestedBy: authResult.currentUser.id,
        exam,
        previous: existingPayload,
        curriculum,
      })
      return NextResponse.json({ examId, ...result })
    }
    const bankIds = exam.enemBankQuestionIds ?? []
    const aiCount = exam.questionCount - bankIds.length

    let aiQuestions: Awaited<ReturnType<typeof attachImagesToExam>>['questions'] = []
    let warnings: string[] = []
    let issues: string[] = []
    let unmappedWarnings: string[] = []
    let alternativesCount = exam.segment === 'anos-iniciais' ? 4 : 5
    let curriculum: Awaited<ReturnType<typeof getCurriculumForExam>> | null = null

    if (aiCount > 0) {
      const qualityGateEnabled = isPedagogicalQualityGateEnabled()
      const activeCurriculum = await getCurriculumForExam({
        segment: exam.segment,
        gradeYear: exam.gradeYear,
        academicYear: exam.academicYear,
        subject: exam.subject,
        bimester: exam.bimester ?? undefined,
        curriculumPlanId: planIdFromExamPayload(exam.generationPayload),
      curriculumPlanVersionId: planVersionIdFromExamPayload(exam.generationPayload),
      })
      curriculum = activeCurriculum

      const split = computeQuestionSplit(aiCount)
      const generatedQuestions: ExamQuestion[] = []
      for (let index = 0; index < aiCount; index++) {
        const questionNumber = index + 1
        const questionType = index < split.objectiveCount ? 'objetiva' as const : 'descritiva' as const
        const priorText = generatedQuestions.slice(-5).map((question) => question.statement.slice(0, 200)).join(' | ')
        let accepted = null
        for (let attempt = 0; attempt < 2 && !accepted; attempt++) {
          const generated = await generateQuestionWithUnifiedFlow({
            curriculum: activeCurriculum,
            questionNumber,
            type: questionType,
            classLabel: (exam.generationPayload as ExamGenerationResult).metadata.classLabel,
            instruction: [
              `regenerar questão ${questionNumber}; tipo ${questionType}`,
              priorText ? `não repita estes enunciados: ${priorText}` : null,
              attempt ? 'Use outro cenário e outra redação; a versão anterior ficou semelhante a outra questão.' : null,
            ].filter(Boolean).join('; '),
          })
          const worst = generatedQuestions.reduce(
            (max, question) => Math.max(max, textSimilarity(questionCoherenceText(generated.question), questionCoherenceText(question))),
            0,
          )
          warnings.push(...generated.warnings)
          if (worst >= EXAM_OVERLAP_BLOCK && attempt === 0) continue
          if (worst >= EXAM_OVERLAP_ALERT) warnings.push(`Questão ${questionNumber}: semelhança de ${Math.round(worst * 100)}% com outra questão; confira na revisão.`)
          accepted = generated.question
        }
        if (!accepted) throw new Error(`Questão ${questionNumber}: não foi possível obter uma versão distinta.`)
        generatedQuestions.push(accepted)
      }
      const examWithImages = await attachImagesToExam({
        metadata: {
          segment: exam.segment,
          gradeYear: exam.gradeYear,
          subject: exam.subject,
          bimester: exam.bimester ?? null,
          questionCount: generatedQuestions.length,
          objectiveCount: generatedQuestions.filter((question) => question.type === 'objetiva').length,
          discursiveCount: generatedQuestions.filter((question) => question.type === 'descritiva').length,
          alternativesCount,
        },
        questions: generatedQuestions,
      }, qualityGateEnabled ? { requireResolvedImages: true, maxAttemptsPerImage: 2, subject: exam.subject } : { subject: exam.subject })
      aiQuestions = examWithImages.questions
      alternativesCount = examWithImages.metadata.alternativesCount

      unmappedWarnings = activeCurriculum.unmappedWarnings
    }

    for (const issue of coherenceIssues(aiQuestions)) {
      warnings.push(`Coerência da prova: ${issue.reason}`)
    }

    const bankQuestions = await buildBankExamQuestions(bankIds, aiQuestions.length + 1)
    const allQuestions = [...aiQuestions, ...bankQuestions]

    // Regenerar apagava o relatório de qualidade e deixava a prova sem como
    // ser aprovada. Reauditamos o conjunto final e persistimos o relatório
    // canônico junto do payload.
    if (!curriculum) {
      curriculum = await getCurriculumForExam({
        segment: exam.segment,
        gradeYear: exam.gradeYear,
        academicYear: exam.academicYear,
        subject: exam.subject,
        bimester: exam.bimester ?? undefined,
        curriculumPlanId: planIdFromExamPayload(exam.generationPayload),
      curriculumPlanVersionId: planVersionIdFromExamPayload(exam.generationPayload),
      })
    }
    let finalQuestions = allQuestions
    let quality = await runQuestionQualityTest(curriculum, finalQuestions, new Map(), existingPayload.metadata.classLabel)
    for (let round = 1; quality.rejected.length && round <= 2; round++) {
      const updates = await Promise.all(quality.rejected.map(async (questionNumber) => {
        const current = finalQuestions.find((question) => question.number === questionNumber)
        const report = quality.report.find((item) => item.questionNumber === questionNumber)
        if (!current || current.source !== 'ia' || !report?.diagnostics?.length) return null
        const diagnostics = report.diagnostics as QualityDiagnostic[]
        if (!diagnostics.some((item) => item.blocksApproval && (item.repairAction === 'reparo_local' || item.repairAction === 'regenerar_questao'))) return null
        const before = JSON.stringify(current)
        try {
          const candidate = (await repairQuestionFromDiagnostics({
            question: current,
            curriculum: curriculum!,
            diagnostics,
            context: `exams/regenerate-quality-repair-${questionNumber}-${round}`,
            classLabel: existingPayload.metadata.classLabel,
          }))?.question ?? null
          return candidate && JSON.stringify(candidate) !== before ? { number: questionNumber, question: candidate } : null
        } catch (error) {
          warnings.push(`Questão ${questionNumber}: correção Jev durante a regeneração falhou (${error instanceof Error ? error.message : 'erro'}).`)
          return null
        }
      }))
      const changed = updates.filter((item): item is NonNullable<typeof item> => item !== null)
      if (!changed.length) break
      finalQuestions = finalQuestions.map((question) => changed.find((item) => item.number === question.number)?.question ?? question)
      quality = await runQuestionQualityTest(curriculum!, finalQuestions, new Map(), existingPayload.metadata.classLabel)
    }
    if (quality.rejected.length) {
      throw new Error(`A regeneração não foi salva porque o Jev ainda reprova as questões ${quality.rejected.join(', ')}. Corrija o problema antes de disponibilizar a prova.`)
    }
    allQuestions.splice(0, allQuestions.length, ...finalQuestions)
    warnings = [...warnings, ...quality.warnings]

    const examWithBank = {
      metadata: {
        segment: exam.segment,
        gradeYear: exam.gradeYear,
        subject: exam.subject,
        ...(existingPayload.metadata.classLabel ? { classLabel: existingPayload.metadata.classLabel } : {}),
        bimester: exam.bimester ?? null,
        questionCount: allQuestions.length,
        objectiveCount: allQuestions.filter((q) => q.type === 'objetiva').length,
        discursiveCount: allQuestions.filter((q) => q.type === 'descritiva').length,
        alternativesCount,
        ...(planIdFromExamPayload(exam.generationPayload) ? { curriculumPlanId: planIdFromExamPayload(exam.generationPayload) } : {}),
        ...(planVersionIdFromExamPayload(exam.generationPayload) ? { curriculumPlanVersionId: planVersionIdFromExamPayload(exam.generationPayload) } : {}),
        qualityTest: {
          version: QUALITY_REPORT_VERSION,
          checkedAt: new Date().toISOString(),
          repairedQuestionNumbers: [],
          warnings: quality.warnings,
          reports: [{ phase: 'Auditoria após regeneração', results: quality.report }],
        },
      },
      questions: allQuestions,
    }

    await db
      .update(generatedExams)
      .set({
        objectiveCount: examWithBank.metadata.objectiveCount,
        discursiveCount: examWithBank.metadata.discursiveCount,
        generationPayload: examWithBank,
        unmappedWarnings: [...unmappedWarnings, ...warnings, ...issues],
      })
      .where(eq(generatedExams.id, examId))

    let pedagogicalClassificationsCreated = 0
    try {
      const pedagogical = await persistGeneratedQuestionClassifications({
        examId,
        questions: examWithBank.questions,
        createdBy: authResult.currentUser.id,
        replaceExisting: true,
        modelProvider: 'deepseek',
        modelName: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
        promptVersion: 'exam-regeneration-pedagogical-v1',
      })
      pedagogicalClassificationsCreated = pedagogical.created.length
    } catch (classificationError) {
      console.error('[exams/regenerate] erro ao persistir classificações pedagógicas:', classificationError)
      warnings.push('Prova regenerada, mas houve erro ao persistir classificações pedagógicas estruturadas.')
    }

    return NextResponse.json({ examId, exam: examWithBank, warnings, issues, pedagogicalClassificationsCreated })
  } catch (err) {
    if (err instanceof StructuredGenerationError) {
      return aiFailureResponse(err, 'A IA não retornou uma prova válida após as tentativas de reparo.')
    }
    if (err instanceof RequiredQuestionImageError) {
      return NextResponse.json({
        error: 'A geração solicitou recurso visual, mas ele não ficou disponível após as tentativas automáticas. A prova anterior foi preservada.',
        questionNumbers: err.questionNumbers,
      }, { status: 502 })
    }
    console.error('[exams/regenerate] erro:', err)
    return aiFailureResponse(err, 'Erro ao regenerar questões.')
  }
}
