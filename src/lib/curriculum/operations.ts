// Operação institucional (Bloco 8): liga planejamento, avaliação e
// intervenção. Funções puras; as rotas só buscam os dados e chamam.

export const OPERATION_RULES = {
  /** Aproveitamento da turma abaixo do qual a habilidade entra como retomada. */
  retakeBelowPercent: 60,
  /** Itens mínimos por aluno avaliado para sugerir retomada (evita sugerir com 1 questão). */
  minItemsPerStudent: 2,
} as const

function normalize(code: string) { return code.trim().toUpperCase() }

/** 1. Prova × planejamento do bimestre: o que a prova cobre, o que deixa de fora e o que está fora do plano. */
export function examPlanCoverage(planned: Array<{ code: string; description: string | null }>, questionCodes: string[][]) {
  const plannedMap = new Map(planned.map((skill) => [normalize(skill.code), skill.description]))
  const examCodes = new Set(questionCodes.flat().map(normalize).filter(Boolean))
  const covered = [...plannedMap.keys()].filter((code) => examCodes.has(code)).sort()
  const missing = [...plannedMap.entries()].filter(([code]) => !examCodes.has(code)).map(([code, description]) => ({ code, description })).sort((a, b) => a.code.localeCompare(b.code))
  const outsidePlan = [...examCodes].filter((code) => !plannedMap.has(code)).sort()
  const unmappedQuestions = questionCodes.filter((codes) => !codes.some((code) => code.trim())).length
  return {
    plannedCount: plannedMap.size,
    covered,
    missing,
    outsidePlan,
    unmappedQuestions,
    coveragePercent: plannedMap.size ? Math.round((covered.length / plannedMap.size) * 100) : null,
  }
}

export type SkillSignal = {
  code: string
  description: string | null
  planned: boolean
  evaluated: boolean
  /** Aproveitamento da turma na habilidade (0–100), ponderado por pontos. */
  percent: number | null
  itemCount: number
  studentCount: number
}

export type Suggestion =
  | { kind: 'avaliar'; title: string; reason: string; codes: string[] }
  | { kind: 'retomar'; title: string; reason: string; codes: string[] }

/** 2 e 3. Habilidades ainda não avaliadas e sugestões de avaliação/retomada. */
export function suggestActions(signals: SkillSignal[], alreadyTargeted: Set<string> = new Set()): Suggestion[] {
  const suggestions: Suggestion[] = []
  const notEvaluated = signals.filter((signal) => signal.planned && !signal.evaluated).map((signal) => signal.code).sort()
  if (notEvaluated.length) {
    suggestions.push({
      kind: 'avaliar',
      title: `Avaliar ${notEvaluated.length} habilidade(s) planejada(s) ainda sem avaliação`,
      reason: 'Planejadas para o bimestre e sem nenhuma questão corrigida até agora.',
      codes: notEvaluated,
    })
  }
  const weak = signals
    .filter((signal) => signal.evaluated && signal.percent !== null && signal.percent < OPERATION_RULES.retakeBelowPercent
      && signal.itemCount >= OPERATION_RULES.minItemsPerStudent * Math.max(1, signal.studentCount)
      && !alreadyTargeted.has(signal.code))
    .sort((a, b) => a.percent! - b.percent!)
  if (weak.length) {
    suggestions.push({
      kind: 'retomar',
      title: `Retomar ${weak.length} habilidade(s) com aproveitamento abaixo de ${OPERATION_RULES.retakeBelowPercent}%`,
      reason: `Turma: ${weak.map((signal) => `${signal.code} (${signal.percent!.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)`).join(', ')}. Sem intervenção aberta para elas.`,
      codes: weak.map((signal) => signal.code),
    })
  }
  return suggestions
}

export type PlanIndicatorInput = {
  planId: number
  academicYear: number
  segment: string
  gradeYear: number
  subject: string
  bimester: number
  officialStatus: 'aprovado' | 'encerrado' | null
  openStatus: 'rascunho' | 'em_revisao' | null
  plannedCount: number
  evaluatedCount: number
  interventions: Array<{ status: 'planejada' | 'em_andamento' | 'concluida'; dueDate: string | null }>
}

export type IndicatorSummary = {
  planCount: number
  approvedCount: number
  inReviewCount: number
  draftOnlyCount: number
  plannedSkillCount: number
  evaluatedSkillCount: number
  coveragePercent: number | null
  interventionsOpen: number
  interventionsOverdue: number
  interventionsDone: number
}

/** 5. Indicadores agregados (escola, por segmento/disciplina ou por professor). */
export function summarizeIndicators(plans: PlanIndicatorInput[], today: string): IndicatorSummary {
  const planned = plans.reduce((sum, plan) => sum + plan.plannedCount, 0)
  const evaluated = plans.reduce((sum, plan) => sum + plan.evaluatedCount, 0)
  const interventions = plans.flatMap((plan) => plan.interventions)
  const open = interventions.filter((item) => item.status !== 'concluida')
  return {
    planCount: plans.length,
    approvedCount: plans.filter((plan) => plan.officialStatus !== null).length,
    inReviewCount: plans.filter((plan) => plan.openStatus === 'em_revisao').length,
    draftOnlyCount: plans.filter((plan) => plan.officialStatus === null && plan.openStatus !== 'em_revisao').length,
    plannedSkillCount: planned,
    evaluatedSkillCount: evaluated,
    coveragePercent: planned ? Math.round((evaluated / planned) * 100) : null,
    interventionsOpen: open.length,
    interventionsOverdue: open.filter((item) => item.dueDate && item.dueDate < today).length,
    interventionsDone: interventions.length - open.length,
  }
}

export function groupIndicators(plans: PlanIndicatorInput[], today: string, key: (plan: PlanIndicatorInput) => string) {
  const groups = new Map<string, PlanIndicatorInput[]>()
  for (const plan of plans) groups.set(key(plan), [...(groups.get(key(plan)) ?? []), plan])
  return [...groups.entries()].map(([label, items]) => ({ label, ...summarizeIndicators(items, today) })).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}
