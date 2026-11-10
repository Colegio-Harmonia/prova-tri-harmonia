import type { ExamQuestion } from '@/lib/gemini/examSchema'

export const CURRENT_SHEET_LAYOUT = 'PTR3'

/** Faixa de alternativas que o cartão-resposta consegue imprimir e ler. */
export const SHEET_MIN_ALTERNATIVES = 4
export const SHEET_MAX_ALTERNATIVES = 5

/** Medidas em mm. PTR1 permanece disponível para cartões já emitidos. */
export function objectiveSheetGeometry(layoutVersion: string) {
  switch (layoutVersion) {
    case 'PTR1': return { firstRowTop: 132.1, rowHeight: 11, rowGap: 13 }
    case 'PTR2': return { firstRowTop: 137, rowHeight: 8, rowGap: 9 }
    case 'PTR3': return { firstRowTop: 98, rowHeight: 8, rowGap: 9 }
    default: throw new Error(`Versão de layout não suportada: ${layoutVersion}`)
  }
}

export type PlannedSheetPage =
  | { kind: 'objective'; questions: ExamQuestion[] }
  | { kind: 'discursive'; questions: ExamQuestion[] }

/** PTR1/PTR2: até 15 objetivas na primeira página e até 3 discursivas por página. */
export function planSheetPages(questions: ExamQuestion[]): PlannedSheetPage[] {
  const objective = questions.filter((question) => question.type === 'objetiva')
  const discursive = questions.filter((question) => question.type === 'descritiva')
  if (objective.length > 15) throw new Error('O cartão-resposta aceita no máximo 15 questões objetivas.')
  for (const question of objective) {
    const count = question.alternatives?.length ?? 0
    if (count < SHEET_MIN_ALTERNATIVES || count > SHEET_MAX_ALTERNATIVES) throw new Error(`A questão ${question.number} precisa ter quatro ou cinco alternativas para o cartão-resposta.`)
  }

  const pages: PlannedSheetPage[] = []
  if (objective.length > 0) pages.push({ kind: 'objective', questions: objective })
  for (let index = 0; index < discursive.length; index += 3) pages.push({ kind: 'discursive', questions: discursive.slice(index, index + 3) })
  if (pages.length === 0) throw new Error('A prova não contém questões para emitir uma folha.')
  return pages
}
