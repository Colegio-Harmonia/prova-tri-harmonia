import { z } from 'zod'
import { SEGMENT_GRADES, SEGMENT_SUBJECTS } from '@/config/subjects'
import { examGenerationResultSchema, type ExamGenerationResult, type ExamQuestion } from '@/lib/gemini/examSchema'
import { manualClassificationComplete } from './creationMode'
export { manualClassificationComplete } from './creationMode'
import { classifyQuestionBloom } from './importedQuestionBloom'
import { classifyQuestionsInep } from './questionInepClassification'

export const manualExamSchema = z.object({
  segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']),
  gradeYear: z.number().int(),
  subject: z.string().min(1),
  academicYear: z.number().int().min(2020).max(2100),
  bimester: z.number().int().min(1).max(4).optional(),
  classLabel: z.string().trim().max(120).optional(),
  assignedTo: z.number().int().positive().optional(),
}).refine((v) => SEGMENT_GRADES[v.segment].includes(v.gradeYear) && SEGMENT_SUBJECTS[v.segment].includes(v.subject), { message: 'Disciplina ou série inválida para este segmento.' })

/** Independent attempts preserve a successful classification when the other service fails. */
export async function classifyManualQuestion(question: ExamQuestion, context: { subject: string; segment: string; gradeYear: number }): Promise<ExamQuestion> {
  let current = question
  for (let attempt = 0; attempt < 3 && !manualClassificationComplete(current); attempt++) {
    const [bloom, inep] = await Promise.allSettled([
      current.bloomAssessment?.status === 'classified' ? Promise.resolve([current]) : classifyQuestionBloom([current], context),
      ['classified', 'not_applicable'].includes(current.inepAssessment?.status ?? '') ? Promise.resolve([current]) : classifyQuestionsInep([current], context),
    ])
    if (bloom.status === 'fulfilled') current = { ...current, bloomLevel: bloom.value[0].bloomLevel, bloomAssessment: bloom.value[0].bloomAssessment }
    if (inep.status === 'fulfilled') current = { ...current, inepAssessment: inep.value[0].inepAssessment, saeb: inep.value[0].saeb }
    if (bloom.status === 'rejected' || inep.status === 'rejected') console.warn('[exams/manual] classificação pendente', { questionId: question.acervoRef?.questionId, attempt: attempt + 1, bloom: bloom.status, inep: inep.status })
  }
  return current
}

export function assembleManualExam(metadata: ExamGenerationResult['metadata'], questions: ExamQuestion[]): ExamGenerationResult {
  const numbered = questions.map((question, index) => ({ ...question, number: index + 1, slotId: `q${String(index + 1).padStart(2, '0')}` }))
  const objectiveCount = numbered.filter((question) => question.type === 'objetiva').length
  return examGenerationResultSchema.parse({ metadata: {
    ...metadata, creationMode: 'manual', questionSource: 'acervo', questionCount: numbered.length, objectiveCount,
    discursiveCount: numbered.length - objectiveCount, alternativesCount: Math.max(0, ...numbered.map((question) => question.alternatives?.length ?? 0)),
  }, questions: numbered })
}
