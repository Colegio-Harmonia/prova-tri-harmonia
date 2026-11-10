import type { CurriculumSelection } from '@/types/exam'
import type { ExamQuestion } from '@/lib/gemini/examSchema'

export function recommendCreationMode(previews: Array<{ data?: CurriculumSelection }>): 'automatic' | 'manual' {
  return previews.length > 0 && previews.every((preview) => preview.data?.units.some((unit) => unit.habilidades.status === 'mapeado' && unit.habilidades.skills.length > 0 || Boolean(unit.enemSkills?.skills.length))) ? 'automatic' : 'manual'
}

export function manualClassificationComplete(question: ExamQuestion) {
  return question.bloomAssessment?.status === 'classified' && ['classified', 'not_applicable'].includes(question.inepAssessment?.status ?? '')
}
