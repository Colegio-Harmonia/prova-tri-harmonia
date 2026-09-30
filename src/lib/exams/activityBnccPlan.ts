import type { CurriculumSelection } from '@/types/exam'

export type ActivityBnccPlanItem = {
  code: string
  questionCount: number
}

export type ActivityBnccSlot = {
  code: string
  questionNumber: number
  units: CurriculumSelection['units']
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase()
}

/**
 * Valida a matriz de habilidades antes de enviar a atividade para a fila.
 * A soma precisa representar exatamente todas as questões solicitadas.
 */
export function validateActivityBnccPlan(plan: ActivityBnccPlanItem[] | undefined, expectedQuestionCount: number) {
  if (!plan?.length) return []
  const normalized = plan
    .map((item) => ({ code: normalizeCode(item.code), questionCount: item.questionCount }))
    .filter((item) => item.questionCount > 0)

  if (!normalized.length) throw new Error('A matriz BNCC precisa ter ao menos uma questão planejada.')
  if (normalized.some((item) => !item.code || !Number.isInteger(item.questionCount) || item.questionCount < 1)) {
    throw new Error('A matriz BNCC contém uma habilidade ou quantidade inválida.')
  }
  if (new Set(normalized.map((item) => item.code)).size !== normalized.length) {
    throw new Error('Cada habilidade BNCC pode aparecer apenas uma vez na matriz da atividade.')
  }
  const total = normalized.reduce((sum, item) => sum + item.questionCount, 0)
  if (total !== expectedQuestionCount) {
    throw new Error(`A matriz BNCC soma ${total} questão(ões), mas a atividade precisa de ${expectedQuestionCount}.`)
  }
  return normalized
}

/** Expande a matriz em posições de geração e vincula cada uma ao currículo correspondente. */
export function buildActivityBnccSlots(
  curriculum: CurriculumSelection,
  plan: ActivityBnccPlanItem[] | undefined,
  expectedQuestionCount: number,
): ActivityBnccSlot[] {
  const validated = validateActivityBnccPlan(plan, expectedQuestionCount)
  if (!validated.length) return []

  const slots: ActivityBnccSlot[] = []
  for (const item of validated) {
    const units = curriculum.units.filter((unit) =>
      unit.habilidades.status === 'mapeado' && unit.habilidades.skills.some((skill) => normalizeCode(skill.code) === item.code),
    )
    if (!units.length) throw new Error(`A habilidade ${item.code} não pertence ao currículo selecionado.`)
    for (let index = 0; index < item.questionCount; index++) {
      slots.push({ code: item.code, questionNumber: slots.length + 1, units })
    }
  }
  return slots
}
