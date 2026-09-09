import type { CurriculumPlanItem, CurriculumSelection } from '@/types/exam'

const VISUAL_CONTENT_PATTERN = /geometr|tri[aâ]ngul|pol[ií]gon|[âa]ngul|circunfer|gr[aá]fic|tabela|mapa|plano cartesiano|fun[cç][aã]o|estat[ií]stic|histogram|diagrama|figura/i

export function shouldRequireVisualAid(unit: CurriculumSelection['units'][number]): boolean {
  return VISUAL_CONTENT_PATTERN.test(`${unit.tituloCapitulo} ${unit.conteudo ?? ''} ${unit.enrichedContent ?? ''}`)
}

export function validateCurriculumPlan(
  units: CurriculumSelection['units'],
  plan: CurriculumPlanItem[] | undefined,
  expectedQuestionCount: number,
): { selectedUnits: CurriculumSelection['units']; plan: CurriculumPlanItem[] } {
  if (!plan?.length) return { selectedUnits: units, plan: [] }

  const byRowIndex = new Map(units.map((unit) => [unit.rowIndex, unit]))
  const seen = new Set<number>()
  let total = 0
  for (const item of plan) {
    if (!byRowIndex.has(item.unitRowIndex)) throw new Error('A matriz contém um capítulo que não pertence ao planejamento selecionado.')
    if (seen.has(item.unitRowIndex)) throw new Error('Cada capítulo pode aparecer apenas uma vez na matriz da avaliação.')
    seen.add(item.unitRowIndex)
    if (!Number.isInteger(item.questionCount) || item.questionCount < 0) throw new Error('A quantidade por capítulo precisa ser um número inteiro não negativo.')
    total += item.questionCount
  }
  if (total !== expectedQuestionCount) {
    throw new Error(`A matriz da avaliação soma ${total} questão(ões), mas a prova precisa de ${expectedQuestionCount}.`)
  }

  return { selectedUnits: plan.filter((item) => item.questionCount > 0).map((item) => byRowIndex.get(item.unitRowIndex)!), plan }
}
