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
// 3. As questões são distribuídas entre as habilidades fracas: no mínimo uma
//    por habilidade, o restante proporcional à distância até 60% (quem está
//    mais longe recebe mais). Se houver mais habilidades que questões, ficam
//    as de menor aproveitamento.

import { MASTERY_RULES, type MasteryEvidenceItem, type PlannedMasterySkill, type StudentMasteryRow } from '@/lib/curriculum/studentMastery'
import type { RecoverySkill } from '@/db/schema'

/** bimester 0 representa o ano todo dentro do cálculo de domínio. */
export const YEAR_SCOPE_BIMESTER = 0

export const RECOVERY_RULES = {
  minQuestions: 3,
  maxQuestions: 20,
  defaultQuestions: 10,
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
  return { weak, insufficient }
}

export function distributeRecoveryQuestions(weak: RecoverySkill[], questionCount: number): Array<{ code: string; questionCount: number }> {
  if (!weak.length || questionCount < 1) return []
  const skills = weak.slice(0, questionCount)
  const remaining = questionCount - skills.length
  // Peso = distância até a faixa de "próximo do domínio" (60%); nunca zero.
  const weights = skills.map((skill) => Math.max(1, MASTERY_RULES.nearMasteryPercent - (skill.masteryPercent ?? 0)))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const exact = weights.map((weight) => (remaining * weight) / totalWeight)
  const extra = exact.map(Math.floor)
  let leftover = remaining - extra.reduce((sum, value) => sum + value, 0)
  // Maior resto primeiro; empate fica com a habilidade mais fraca (ordem de entrada).
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index)
  for (const { index } of order) {
    if (leftover <= 0) break
    extra[index]! += 1
    leftover -= 1
  }
  return skills.map((skill, index) => ({ code: skill.code, questionCount: 1 + extra[index]! }))
}

export function periodLabel(bimester: number | null, semester?: number | null) {
  if (bimester) return `${bimester}º bimestre`
  if (semester) return `${semester}º semestre`
  return 'Ano todo'
}
