// Regra pura da prova de recuperação individualizada (18/11/2026).
//
// 1. O período é escolhido pelo professor: um bimestre, um semestre (1º =
//    bimestres 1-2, 2º = 3-4; o colégio é semestral) ou o ano todo. Em semestre
//    e ano, as evidências dos bimestres do período somam numa leitura só por
//    habilidade (um código retomado no 2º bimestre conta junto com o do 1º).
// 2. Entram na prova só as habilidades "em desenvolvimento": aproveitamento
//    abaixo de 60% com pelo menos 3 questões avaliadas (MASTERY_RULES). Com
//    menos de 3 questões a leitura é "evidência insuficiente": a habilidade
//    não entra e aparece como aviso para o professor.
//    Exceção (26/11/2026, lote 7): se o aluno não tem NENHUMA habilidade fraca
//    com amostra suficiente (ex.: só uma prova corrigida no semestre, uma
//    questão por habilidade), entram as de amostra pequena abaixo de 60%,
//    marcadas `smallSample` para o professor conferir na matriz. Sem isso o
//    lote inteiro ficava "sem habilidades" e nada era gerado.
// 3. As questões são distribuídas entre as habilidades fracas: no mínimo uma
//    por habilidade, o restante proporcional à distância até 60% (quem está
//    mais longe recebe mais). Se houver mais habilidades que questões, ficam
//    as de menor aproveitamento.

import { MASTERY_RULES, type MasteryEvidenceItem, type PlannedMasterySkill, type StudentMasteryRow } from '@/lib/curriculum/studentMastery'
import type { RecoveryContentPlanItem, RecoverySkill } from '@/db/schema'

/** bimester 0 representa o ano todo dentro do cálculo de domínio. */
export const YEAR_SCOPE_BIMESTER = 0

// Mesma faixa da tela Gerar prova (o job gerar_prova exige 10 a 30).
export const RECOVERY_RULES = {
  minQuestions: 10,
  maxQuestions: 30,
  defaultQuestions: 12,
  defaultObjectivePercentage: 70,
} as const

/** Período do lote: bimestre, semestre ou (os dois nulos) ano todo. */
export type RecoveryPeriod = { bimester: number | null; semester?: number | null }

/** Bimestres cobertos pelo período; null = todos (ano todo). */
export function periodBimesters(period: RecoveryPeriod): number[] | null {
  if (period.bimester) return [period.bimester]
  if (period.semester) return [period.semester * 2 - 1, period.semester * 2]
  return null
}

/** Recorta pelo período; em semestre e ano, funde os bimestres numa leitura só. */
export function evidenceForPeriod<T extends MasteryEvidenceItem>(evidence: T[], period: RecoveryPeriod): T[] {
  if (period.bimester) return evidence.filter((item) => item.bimester === period.bimester)
  const bimesters = periodBimesters(period)
  return evidence.filter((item) => !bimesters || bimesters.includes(item.bimester)).map((item) => ({ ...item, bimester: YEAR_SCOPE_BIMESTER }))
}

/** Mesmo recorte para as habilidades planejadas, sem repetir código ao fundir bimestres. */
export function plannedForPeriod(planned: PlannedMasterySkill[], period: RecoveryPeriod): PlannedMasterySkill[] {
  if (period.bimester) return planned.filter((skill) => skill.bimester === period.bimester)
  const bimesters = periodBimesters(period)
  const seen = new Map<string, PlannedMasterySkill>()
  for (const skill of planned) {
    if (bimesters && !bimesters.includes(skill.bimester)) continue
    const code = skill.code.trim().toUpperCase()
    if (!seen.has(code)) seen.set(code, { ...skill, bimester: YEAR_SCOPE_BIMESTER })
  }
  return [...seen.values()]
}

function toRecoverySkill(row: StudentMasteryRow): RecoverySkill {
  return { code: row.code, description: row.description, masteryPercent: row.masteryPercent, itemCount: row.itemCount }
}

export function selectRecoverySkills(rows: StudentMasteryRow[]): { weak: RecoverySkill[]; insufficient: RecoverySkill[] } {
  const byPercent = (a: RecoverySkill, b: RecoverySkill) => (a.masteryPercent ?? 0) - (b.masteryPercent ?? 0) || a.code.localeCompare(b.code)
  const weak = rows.filter((row) => row.level === 'em_desenvolvimento').map(toRecoverySkill).sort(byPercent)
  const insufficient = rows.filter((row) => row.level === 'evidencia_insuficiente').map(toRecoverySkill).sort(byPercent)
  if (weak.length) return { weak, insufficient }
  const isBelow = (skill: RecoverySkill) => skill.itemCount > 0 && skill.masteryPercent !== null && skill.masteryPercent < MASTERY_RULES.nearMasteryPercent
  return {
    weak: insufficient.filter(isBelow).map((skill) => ({ ...skill, smallSample: true })),
    insufficient: insufficient.filter((skill) => !isBelow(skill)),
  }
}

/** Peso de uma habilidade fraca: distância até 60% ("próximo do domínio"); nunca zero. */
function deficit(skill: RecoverySkill) {
  return Math.max(1, MASTERY_RULES.nearMasteryPercent - (skill.masteryPercent ?? 0))
}

/**
 * Reparte `total` entre itens já ordenados por prioridade: no mínimo um por
 * item, o resto proporcional ao peso (maior resto; empate fica com o item
 * que vem antes). Com mais itens que o total, ficam os primeiros.
 */
function distributeByWeight<T>(items: Array<{ item: T; weight: number }>, total: number): Array<{ item: T; count: number }> {
  if (!items.length || total < 1) return []
  const kept = items.slice(0, total)
  const remaining = total - kept.length
  const totalWeight = kept.reduce((sum, entry) => sum + entry.weight, 0)
  const exact = kept.map((entry) => (remaining * entry.weight) / totalWeight)
  const extra = exact.map(Math.floor)
  let leftover = remaining - extra.reduce((sum, value) => sum + value, 0)
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index)
  for (const { index } of order) {
    if (leftover <= 0) break
    extra[index]! += 1
    leftover -= 1
  }
  return kept.map((entry, index) => ({ item: entry.item, count: 1 + extra[index]! }))
}

export function distributeRecoveryQuestions(weak: RecoverySkill[], questionCount: number): Array<{ code: string; questionCount: number }> {
  return distributeByWeight(weak.map((skill) => ({ item: skill.code, weight: deficit(skill) })), questionCount).map(({ item, count }) => ({ code: item, questionCount: count }))
}

export type RecoveryUnit = { rowIndex: number; codes: string[] }

/**
 * Matriz por capítulo do aluno (a "Distribuição planejada por capítulo" da
 * Gerar prova). Entram os capítulos do período que trabalham alguma
 * habilidade fraca; o peso do capítulo é a soma dos déficits das fracas que
 * ele tem (uma habilidade presente em dois capítulos divide o peso). Fracas
 * que nenhum capítulo do período planeja voltam em `unplannedCodes`.
 */
export function buildRecoveryContentPlan(units: RecoveryUnit[], weak: RecoverySkill[], questionCount: number): { contentPlan: RecoveryContentPlanItem[]; unplannedCodes: string[] } {
  const weakByCode = new Map(weak.map((skill) => [skill.code.toUpperCase(), skill]))
  const unitsByCode = new Map<string, number>()
  for (const unit of units) for (const code of new Set(unit.codes.map((value) => value.toUpperCase()))) if (weakByCode.has(code)) unitsByCode.set(code, (unitsByCode.get(code) ?? 0) + 1)
  const weighted = units.map((unit) => {
    const codes = [...new Set(unit.codes.map((value) => value.toUpperCase()))].filter((code) => weakByCode.has(code))
    return { item: unit.rowIndex, weight: codes.reduce((sum, code) => sum + deficit(weakByCode.get(code)!) / unitsByCode.get(code)!, 0) }
  }).filter((entry) => entry.weight > 0)
    // Mais pesado primeiro; empate na ordem do planejamento.
    .sort((a, b) => b.weight - a.weight || a.item - b.item)
  const contentPlan = distributeByWeight(weighted, questionCount)
    .map(({ item, count }) => ({ unitRowIndex: item, questionCount: count, priority: 'alta' as const, visualAid: 'auto' as const }))
    .sort((a, b) => a.unitRowIndex - b.unitRowIndex)
  return { contentPlan, unplannedCodes: [...weakByCode.keys()].filter((code) => !unitsByCode.has(code)) }
}

/** Valida a matriz ajustada pelo professor contra os capítulos do período e o total do lote. */
export function validateRecoveryContentPlan(plan: RecoveryContentPlanItem[], unitRowIndexes: number[], total: number): string | null {
  const known = new Set(unitRowIndexes)
  const positive = plan.filter((item) => item.questionCount > 0)
  if (!positive.length) return 'A matriz precisa de ao menos um capítulo com questão.'
  if (positive.some((item) => !known.has(item.unitRowIndex))) return 'A matriz tem capítulo que não pertence ao planejamento do período.'
  if (new Set(positive.map((item) => item.unitRowIndex)).size !== positive.length) return 'Cada capítulo pode aparecer uma vez na matriz.'
  const sum = positive.reduce((acc, item) => acc + item.questionCount, 0)
  if (sum !== total) return `A matriz soma ${sum} questão(ões); o lote pede ${total}.`
  return null
}

export function periodLabel(bimester: number | null, semester?: number | null) {
  if (bimester) return `${bimester}º bimestre`
  if (semester) return `${semester}º semestre`
  return 'Ano todo'
}
