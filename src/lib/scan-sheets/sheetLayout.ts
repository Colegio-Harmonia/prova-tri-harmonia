import type { ExamQuestion } from '@/lib/gemini/examSchema'

export type PlannedSheetPage =
  | { kind: 'objective'; questions: ExamQuestion[] }
  | { kind: 'discursive'; questions: ExamQuestion[] }

/** PTR1: até 15 objetivas na primeira página e até 3 discursivas por página. */
export function planSheetPages(questions: ExamQuestion[]): PlannedSheetPage[] {
  const objective = questions.filter((question) => question.type === 'objetiva')
  const discursive = questions.filter((question) => question.type === 'descritiva')
  if (objective.length > 15) throw new Error('O layout PTR1 aceita no máximo 15 questões objetivas.')
  for (const question of objective) {
    const count = question.alternatives?.length ?? 0
    if (count < 4 || count > 5) throw new Error(`A questão ${question.number} precisa ter quatro ou cinco alternativas para o layout PTR1.`)
  }

  const pages: PlannedSheetPage[] = []
  if (objective.length > 0) pages.push({ kind: 'objective', questions: objective })
  for (let index = 0; index < discursive.length; index += 3) pages.push({ kind: 'discursive', questions: discursive.slice(index, index + 3) })
  if (pages.length === 0) throw new Error('A prova não contém questões para emitir uma folha.')
  return pages
}
