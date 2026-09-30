import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { auth } from '@/auth/auth'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { computeQuestionSplit } from '@/lib/gemini/promptBuilder'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
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
