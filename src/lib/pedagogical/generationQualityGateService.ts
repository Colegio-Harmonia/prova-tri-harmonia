import type { CurriculumSelection } from '@/types/exam'
import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import {
  applyBlindPedagogicalReview,
  blindPedagogicalReviewSchema,
  BLIND_PEDAGOGICAL_REVIEW_RESPONSE_SCHEMA,
  buildBlindPedagogicalReviewPrompt,
  validateBlindPedagogicalReviewArtifacts,
  type PedagogicalFidelityGateResult,
} from './generationQualityGate'

export async function validateGeneratedExamPedagogicalFidelity(
  curriculum: Pick<CurriculumSelection, 'segment' | 'gradeYear' | 'subject'>,
  result: ExamGenerationResult,
): Promise<PedagogicalFidelityGateResult> {
  const review = await generateValidatedStructuredContent({
    context: 'pedagogical/blind-generation-review',
    prompt: buildBlindPedagogicalReviewPrompt(curriculum, result.questions),
    responseSchema: BLIND_PEDAGOGICAL_REVIEW_RESPONSE_SCHEMA,
    zodSchema: blindPedagogicalReviewSchema,
    validate: (parsedReview) => ({
      value: parsedReview,
      issues: validateBlindPedagogicalReviewArtifacts(result.questions, parsedReview),
    }),
  })

  return applyBlindPedagogicalReview(result, review.value)
}

export async function validateGeneratedQuestionPedagogicalFidelity(
  curriculum: Pick<CurriculumSelection, 'segment' | 'gradeYear' | 'subject'>,
  question: ExamQuestion,
): Promise<{ question: ExamQuestion; issues: string[]; warnings: string[] }> {
  const result = await validateGeneratedExamPedagogicalFidelity(curriculum, {
    metadata: {
      segment: curriculum.segment,
      gradeYear: curriculum.gradeYear,
      subject: curriculum.subject,
      questionCount: 1,
      objectiveCount: question.type === 'objetiva' ? 1 : 0,
      discursiveCount: question.type === 'descritiva' ? 1 : 0,
      alternativesCount: question.alternatives?.length ?? 0,
    },
    questions: [question],
  })

  return { question: result.corrected.questions[0] ?? question, issues: result.issues, warnings: result.warnings }
}
