import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { classifyQuestionBloom } from './importedQuestionBloom'
import { classifyQuestionsInep } from './questionInepClassification'

/** Classify final AI/acervo tasks; preserve the ENEM bank's existing classifications. */
export async function classifyExamQuestions(questions: ExamQuestion[], context: { subject: string; gradeYear: number; segment: string }) {
  const pending = questions.filter((question) => question.source !== 'enem_bank')
  if (!pending.length) return questions
  let classified = pending
  for (let attempt = 1; attempt <= 3; attempt++) {
    const incomplete = classified.filter((question) => !question.bloomAssessment || question.bloomAssessment.status !== 'classified'
      || !question.inepAssessment || !['classified', 'not_applicable'].includes(question.inepAssessment.status))
    if (!incomplete.length && attempt > 1) break
    const targets = attempt === 1 ? classified : incomplete
    const updated = await classifyQuestionsInep(await classifyQuestionBloom(targets, context), context)
    const updatedByNumber = new Map(updated.map((question) => [question.number, question]))
    classified = classified.map((question) => updatedByNumber.get(question.number) ?? question)
  }
  const incomplete = classified.filter((question) => question.bloomAssessment?.status !== 'classified'
    || !question.inepAssessment || !['classified', 'not_applicable'].includes(question.inepAssessment.status))
  if (incomplete.length) throw new Error(`A classificação JEV não foi concluída nas questões ${incomplete.map((question) => question.number).join(', ')} após três tentativas. A fila deve repetir a classificação antes de concluir a geração.`)
  const byNumber = new Map(classified.map((question) => [question.number, question]))
  return questions.map((question) => question.source === 'enem_bank' ? question : byNumber.get(question.number) ?? question)
}
