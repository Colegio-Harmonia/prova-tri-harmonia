import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { auth } from '@/auth/auth'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { buildExamPrompt } from '@/lib/gemini/promptBuilder'
import { examGenerationResultSchema, GEMINI_RESPONSE_SCHEMA, type ExamGenerationResult } from '@/lib/gemini/examSchema'
import { validateExamResult } from '@/lib/gemini/examValidator'
import { attachImagesToExam, RequiredQuestionImageError } from '@/lib/images/questionImageService'
import { buildBankExamQuestions } from '@/lib/gemini/enemBankMerge'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { persistGeneratedQuestionClassifications } from '@/lib/pedagogical/generatedQuestionClassificationService'
import { generateValidatedStructuredContent, StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import { aiFailureResponse } from '@/lib/ai/routeFailure'
import { isPedagogicalQualityGateEnabled } from '@/lib/pedagogical/generationQualityGate'
import { validateGeneratedExamPedagogicalFidelity } from '@/lib/pedagogical/generationQualityGateService'

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

    if (aiCount > 0) {
      const qualityGateEnabled = isPedagogicalQualityGateEnabled()
      const curriculum = await getCurriculumForExam({
        segment: exam.segment,
        gradeYear: exam.gradeYear,
        subject: exam.subject,
        bimester: exam.bimester ?? undefined,
      })

      const genParams = { questionCount: aiCount }
      const prompt = await buildExamPrompt(curriculum, genParams)
      const generated = await generateValidatedStructuredContent<ExamGenerationResult, ExamGenerationResult>({
        context: 'exams/regenerate',
        prompt,
        responseSchema: GEMINI_RESPONSE_SCHEMA,
        zodSchema: examGenerationResultSchema,
        validate: async (parsedExam) => {
          const validation = validateExamResult(parsedExam, curriculum, { ...genParams, enforcePedagogicalCompleteness: qualityGateEnabled })
          if (validation.issues.length || !qualityGateEnabled) {
            return { value: validation.corrected, issues: validation.issues, warnings: validation.warnings }
          }
          const fidelity = await validateGeneratedExamPedagogicalFidelity(curriculum, validation.corrected)
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
      warnings = generated.warnings
      if (generated.repaired) warnings.push(`Resposta da IA validada após reparo (${generated.attempts} tentativa(s)).`)
      unmappedWarnings = curriculum.unmappedWarnings
      alternativesCount = examWithImages.metadata.alternativesCount
    }

    const bankQuestions = await buildBankExamQuestions(bankIds, aiQuestions.length + 1)
    const allQuestions = [...aiQuestions, ...bankQuestions]
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
