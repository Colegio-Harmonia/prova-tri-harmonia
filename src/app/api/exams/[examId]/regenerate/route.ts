import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { auth } from '@/auth/auth'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { buildExamPrompt, computeQuestionSplit } from '@/lib/gemini/promptBuilder'
import { examGenerationResultSchema, GEMINI_RESPONSE_SCHEMA, type ExamGenerationResult, type ExamQuestion } from '@/lib/gemini/examSchema'
import { validateExamResult, correctSingleQuestion } from '@/lib/gemini/examValidator'
import { attachImagesToExam, RequiredQuestionImageError } from '@/lib/images/questionImageService'
import { buildBankExamQuestions } from '@/lib/gemini/enemBankMerge'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { persistGeneratedQuestionClassifications } from '@/lib/pedagogical/generatedQuestionClassificationService'
import { generateValidatedStructuredContent, StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import { aiFailureResponse } from '@/lib/ai/routeFailure'
import { isPedagogicalQualityGateEnabled } from '@/lib/pedagogical/generationQualityGate'
import { validateGeneratedExamPedagogicalFidelity } from '@/lib/pedagogical/generationQualityGateService'
import { runQuestionQualityTest } from '@/lib/exams/questionQualityTest'
import { QUALITY_REPORT_VERSION } from '@/lib/exams/qualityReport'
import { generateStagedQuestion, isStagedGenerationEnabled } from '@/lib/generation'

export async function POST(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const authResult = await authorizeExamAccess(examId, session.user.email)
  if ('error' in authResult) return authResult.error
  const { exam } = authResult
  if (exam.status !== 'rascunho') {
    return NextResponse.json({ error: 'Só é possível regenerar provas em rascunho.' }, { status: 409 })
  }

  try {
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
        subject: exam.subject,
        bimester: exam.bimester ?? undefined,
      })
      curriculum = activeCurriculum

      const genParams = { questionCount: aiCount }
      const split = computeQuestionSplit(aiCount)
      const stagedCurriculumContent = activeCurriculum.units
        .map((unit) => [unit.tituloCapitulo, unit.conteudo, unit.enrichedContent].filter(Boolean).join('\n'))
        .join('\n\n')
        .slice(0, 12000)
      const stagedQuestions: ExamQuestion[] = []
      let stagedFailure: string | null = isStagedGenerationEnabled() ? null : 'Pipeline fragmentado desligado.'

      if (!stagedFailure) {
        for (let index = 0; index < aiCount; index++) {
          const questionType: ExamQuestion['type'] = index < split.objectiveCount ? 'objetiva' : 'descritiva'
          try {
            const staged = await generateStagedQuestion({
              questionNumber: index + 1,
              subject: exam.subject,
              gradeYear: exam.gradeYear,
              segment: exam.segment,
              curriculumContent: stagedCurriculumContent,
              contentPlanInstruction: `tipo ${questionType}`,
              questionType,
            })
            const corrected = correctSingleQuestion({ ...staged.question, number: index + 1 }, activeCurriculum, { allowMathReviewFallback: true })
            if (corrected.issues.length) throw new Error(corrected.issues.join(' '))
            stagedQuestions.push({ ...corrected.question, number: index + 1 })
            warnings.push(...staged.issues.map((issue) => `Questão ${index + 1} [${issue.severity}]: ${issue.reason}`))
            warnings.push(...corrected.warnings)
          } catch (error) {
            stagedFailure = `Questão ${index + 1}: ${error instanceof Error ? error.message : 'falha no pipeline fragmentado'}.`
            break
          }
        }
      }

      if (!stagedFailure) {
        const examWithImages = await attachImagesToExam({
          metadata: {
            segment: exam.segment,
            gradeYear: exam.gradeYear,
            subject: exam.subject,
            bimester: exam.bimester ?? null,
            questionCount: stagedQuestions.length,
            objectiveCount: stagedQuestions.filter((question) => question.type === 'objetiva').length,
            discursiveCount: stagedQuestions.filter((question) => question.type === 'descritiva').length,
            alternativesCount,
          },
          questions: stagedQuestions,
        }, qualityGateEnabled ? { requireResolvedImages: true, maxAttemptsPerImage: 2, subject: exam.subject } : { subject: exam.subject })
        aiQuestions = examWithImages.questions
        alternativesCount = examWithImages.metadata.alternativesCount
      } else {
        warnings.push(`${stagedFailure} Regenerando pelo fluxo monolítico.`)
        const prompt = await buildExamPrompt(activeCurriculum, genParams)
        const generated = await generateValidatedStructuredContent<ExamGenerationResult, ExamGenerationResult>({
          context: 'exams/regenerate',
          prompt,
          responseSchema: GEMINI_RESPONSE_SCHEMA,
          zodSchema: examGenerationResultSchema,
          validate: async (parsedExam) => {
            const validation = validateExamResult(parsedExam, activeCurriculum, { ...genParams, enforcePedagogicalCompleteness: qualityGateEnabled })
            if (validation.issues.length || !qualityGateEnabled) {
              return { value: validation.corrected, issues: validation.issues, warnings: validation.warnings }
            }
            const fidelity = await validateGeneratedExamPedagogicalFidelity(activeCurriculum, validation.corrected)
            return {
              value: fidelity.corrected,
              issues: fidelity.issues,
              warnings: [...validation.warnings, ...fidelity.warnings],
            }
          },
        })
        const examWithImages = await attachImagesToExam(generated.value, qualityGateEnabled
          ? { requireResolvedImages: true, maxAttemptsPerImage: 2 }
          : undefined)
        aiQuestions = examWithImages.questions
        warnings.push(...generated.warnings)
        if (generated.repaired) warnings.push(`Resposta da IA validada após reparo (${generated.attempts} tentativa(s)).`)
        alternativesCount = examWithImages.metadata.alternativesCount
      }

      unmappedWarnings = activeCurriculum.unmappedWarnings
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
        subject: exam.subject,
        bimester: exam.bimester ?? undefined,
      })
    }
    const quality = await runQuestionQualityTest(curriculum, allQuestions)
    warnings = [...warnings, ...quality.warnings]

    const examWithBank = {
      metadata: {
        segment: exam.segment,
        gradeYear: exam.gradeYear,
        subject: exam.subject,
        bimester: exam.bimester ?? null,
        questionCount: allQuestions.length,
        objectiveCount: allQuestions.filter((q) => q.type === 'objetiva').length,
        discursiveCount: allQuestions.filter((q) => q.type === 'descritiva').length,
        alternativesCount,
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
