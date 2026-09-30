// Domínio individual das habilidades BNCC (Bloco 4).
//
// Aproveitamento = pontos obtidos ÷ pontos possíveis nas questões ligadas à
// habilidade, respeitando o peso de cada questão e a nota parcial das
// discursivas. Uma questão ligada a dois códigos conta como evidência para
// os dois.
//
// Regra de prudência: a amostra limita a conclusão. Com poucos itens, a
// leitura fica em "evidência insuficiente" (o percentual aparece só como
// preliminar). "Domínio" é a conclusão mais forte e exige itens e avaliações
// distintas suficientes; sem isso, um aproveitamento alto é rebaixado para
// "próximo do domínio" e marcado como limitado pela amostra.

export const MASTERY_LEVELS = ['sem_evidencia', 'evidencia_insuficiente', 'em_desenvolvimento', 'proximo_do_dominio', 'dominio'] as const
export type MasteryLevel = (typeof MASTERY_LEVELS)[number]

export const MASTERY_RULES = {
  /** Mínimo de itens (questões distintas) para qualquer leitura pedagógica. */
  minItemsForReading: 3,
  /** Mínimo de itens e de avaliações distintas para afirmar domínio. */
  minItemsForMastery: 4,
  minAssessmentsForMastery: 2,
  /** Faixas de aproveitamento (%), inclusivas no limite inferior. */
  masteryPercent: 80,
  nearMasteryPercent: 60,
} as const

export type MasteryScope = {
  academicYear: number
  segment: string
  gradeYear: number
  subject: string
  bimester: number
}

export type PlannedMasterySkill = MasteryScope & {
  code: string
  description: string | null
  targetMasteryPercent: number
}

/** Uma resposta revisada de uma questão ligada a um código BNCC. */
export type MasteryEvidenceItem = MasteryScope & {
  code: string
  description: string | null
  examId: number
  questionNumber: number
  earnedPoints: number
  possiblePoints: number
}

export type StudentMasteryRow = MasteryScope & {
  code: string
  description: string | null
  planned: boolean
  targetMasteryPercent: number
  /** Aproveitamento ponderado (0–100); null sem evidência. Preliminar quando `level` é evidencia_insuficiente. */
  masteryPercent: number | null
  earnedPoints: number
  possiblePoints: number
  itemCount: number
  assessmentCount: number
  level: MasteryLevel
  /** true quando o aproveitamento indicaria domínio, mas a amostra não sustenta essa conclusão. */
  limitedBySample: boolean
}

export type MasteryConsolidation = {
  academicYear: number
  segment: string
  gradeYear: number
  subject: string
  /** null na consolidação anual da disciplina. */
  bimester: number | null
  skillCount: number
  plannedSkillCount: number
  levelCounts: Record<MasteryLevel, number>
  /** Aproveitamento ponderado de todas as evidências do grupo; null sem evidência. */
  masteryPercent: number | null
  itemCount: number
  assessmentCount: number
}

function normalizeCode(code: string) { return code.trim().toUpperCase() }
function subjectKey(subject: string) { return subject.toLocaleLowerCase('pt-BR') }
function scopeKey(row: MasteryScope) { return `${row.academicYear}:${row.segment}:${row.gradeYear}:${subjectKey(row.subject)}:${row.bimester}` }
function rowKey(row: MasteryScope & { code: string }) { return `${scopeKey(row)}:${normalizeCode(row.code)}` }
function percent(earned: number, possible: number) { return possible > 0 ? Math.round((earned / possible) * 1000) / 10 : null }
function emptyLevelCounts(): Record<MasteryLevel, number> { return Object.fromEntries(MASTERY_LEVELS.map((level) => [level, 0])) as Record<MasteryLevel, number> }

export function masteryLevel(masteryPercent: number | null, itemCount: number, assessmentCount: number): { level: MasteryLevel; limitedBySample: boolean } {
  if (itemCount === 0 || masteryPercent === null) return { level: 'sem_evidencia', limitedBySample: false }
  if (itemCount < MASTERY_RULES.minItemsForReading) return { level: 'evidencia_insuficiente', limitedBySample: false }
  if (masteryPercent >= MASTERY_RULES.masteryPercent) {
    const enough = itemCount >= MASTERY_RULES.minItemsForMastery && assessmentCount >= MASTERY_RULES.minAssessmentsForMastery
    return enough ? { level: 'dominio', limitedBySample: false } : { level: 'proximo_do_dominio', limitedBySample: true }
  }
  if (masteryPercent >= MASTERY_RULES.nearMasteryPercent) return { level: 'proximo_do_dominio', limitedBySample: false }
  return { level: 'em_desenvolvimento', limitedBySample: false }
}

type Accumulator = StudentMasteryRow & { items: Set<string>; assessments: Set<number> }

export function calculateStudentMastery(plannedSkills: PlannedMasterySkill[], evidence: MasteryEvidenceItem[]): StudentMasteryRow[] {
  const merged = new Map<string, Accumulator>()
  const blank = { masteryPercent: null, earnedPoints: 0, possiblePoints: 0, itemCount: 0, assessmentCount: 0, level: 'sem_evidencia' as MasteryLevel, limitedBySample: false }

  for (const skill of plannedSkills) {
    const code = normalizeCode(skill.code)
    const key = rowKey({ ...skill, code })
    if (!merged.has(key)) merged.set(key, { ...skill, code, planned: true, ...blank, items: new Set(), assessments: new Set() })
  }

  for (const item of evidence) {
    if (!(item.possiblePoints > 0)) continue
    const code = normalizeCode(item.code)
    const key = rowKey({ ...item, code })
    const current = merged.get(key) ?? {
      academicYear: item.academicYear, segment: item.segment, gradeYear: item.gradeYear, subject: item.subject, bimester: item.bimester,
      code, description: item.description, planned: false, targetMasteryPercent: 100, ...blank, items: new Set<string>(), assessments: new Set<number>(),
    }
    const itemKey = `${item.examId}:${item.questionNumber}`
    // A mesma questão não conta duas vezes para a mesma habilidade.
    if (!current.items.has(itemKey)) {
      current.items.add(itemKey)
      current.assessments.add(item.examId)
      current.earnedPoints += Math.min(Math.max(item.earnedPoints, 0), item.possiblePoints)
      current.possiblePoints += item.possiblePoints
    }
    if (!current.description && item.description) current.description = item.description
    merged.set(key, current)
  }

  return [...merged.values()].map(({ items, assessments, ...row }) => {
    const masteryPercent = percent(row.earnedPoints, row.possiblePoints)
    const { level, limitedBySample } = masteryLevel(masteryPercent, items.size, assessments.size)
    return { ...row, masteryPercent, itemCount: items.size, assessmentCount: assessments.size, level, limitedBySample }
  }).sort((a, b) => a.academicYear - b.academicYear || a.bimester - b.bimester || a.subject.localeCompare(b.subject, 'pt-BR') || a.code.localeCompare(b.code))
}

/**
 * Consolida por disciplina e bimestre e por disciplina no ano. Itens e
 * avaliações vêm das evidências (não da soma das linhas), para que uma
 * questão ligada a dois códigos não seja contada duas vezes no grupo.
 */
export function consolidateMastery(rows: StudentMasteryRow[], evidence: MasteryEvidenceItem[]) {
  const build = (withBimester: boolean) => {
    const groups = new Map<string, MasteryConsolidation & { items: Map<string, { earned: number; possible: number }>; assessments: Set<number> }>()
    const groupKey = (row: MasteryScope) => `${row.academicYear}:${row.segment}:${row.gradeYear}:${subjectKey(row.subject)}:${withBimester ? row.bimester : '*'}`
    const ensure = (row: MasteryScope) => {
      const key = groupKey(row)
      if (!groups.has(key)) groups.set(key, {
        academicYear: row.academicYear, segment: row.segment, gradeYear: row.gradeYear, subject: row.subject, bimester: withBimester ? row.bimester : null,
        skillCount: 0, plannedSkillCount: 0, levelCounts: emptyLevelCounts(), masteryPercent: null, itemCount: 0, assessmentCount: 0,
        items: new Map(), assessments: new Set(),
      })
      return groups.get(key)!
    }
    for (const row of rows) {
      const group = ensure(row)
      group.skillCount++
      if (row.planned) group.plannedSkillCount++
      group.levelCounts[row.level]++
    }
    for (const item of evidence) {
      if (!(item.possiblePoints > 0)) continue
      const group = ensure(item)
      const itemKey = `${item.examId}:${item.questionNumber}`
      if (!group.items.has(itemKey)) group.items.set(itemKey, { earned: Math.min(Math.max(item.earnedPoints, 0), item.possiblePoints), possible: item.possiblePoints })
      group.assessments.add(item.examId)
    }
    return [...groups.values()].map(({ items, assessments, ...group }) => {
      const earned = [...items.values()].reduce((sum, item) => sum + item.earned, 0)
      const possible = [...items.values()].reduce((sum, item) => sum + item.possible, 0)
      return { ...group, masteryPercent: percent(earned, possible), itemCount: items.size, assessmentCount: assessments.size }
    }).sort((a, b) => a.academicYear - b.academicYear || a.subject.localeCompare(b.subject, 'pt-BR') || (a.bimester ?? 0) - (b.bimester ?? 0))
  }
  return { bySubjectBimester: build(true), bySubject: build(false) }
}
