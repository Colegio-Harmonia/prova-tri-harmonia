export type MasteryStatus = 'dominio' | 'desenvolvimento' | 'prioridade' | 'amostra_insuficiente' | 'sem_evidencia'

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

export type ObservedMasteryEvidence = MasteryScope & {
  code: string
  description: string | null
  scoreSum: number
  evidenceCount: number
}

export type StudentMasteryRow = MasteryScope & {
  code: string
  description: string | null
  planned: boolean
  targetMasteryPercent: number
  masteryPercent: number | null
  evidenceCount: number
  status: MasteryStatus
}

function normalizeCode(code: string) { return code.trim().toUpperCase() }
function key(row: MasteryScope & { code: string }) {
  return `${row.academicYear}:${row.segment}:${row.gradeYear}:${row.subject.toLocaleLowerCase('pt-BR')}:${row.bimester}:${normalizeCode(row.code)}`
}

export function masteryStatus(masteryPercent: number | null, evidenceCount: number): MasteryStatus {
  if (evidenceCount === 0 || masteryPercent === null) return 'sem_evidencia'
  if (evidenceCount < 3) return 'amostra_insuficiente'
  if (masteryPercent >= 80) return 'dominio'
  if (masteryPercent >= 60) return 'desenvolvimento'
  return 'prioridade'
}

export function calculateStudentMastery(
  plannedSkills: PlannedMasterySkill[],
  observedEvidence: ObservedMasteryEvidence[],
): StudentMasteryRow[] {
  const merged = new Map<string, StudentMasteryRow & { scoreSum: number }>()

  for (const skill of plannedSkills) {
    const code = normalizeCode(skill.code)
    const rowKey = key({ ...skill, code })
    if (!merged.has(rowKey)) merged.set(rowKey, {
      ...skill, code, planned: true, masteryPercent: null, evidenceCount: 0, status: 'sem_evidencia', scoreSum: 0,
    })
  }

  for (const evidence of observedEvidence) {
    const code = normalizeCode(evidence.code)
    const rowKey = key({ ...evidence, code })
    const current = merged.get(rowKey) ?? {
      ...evidence, code, planned: false, targetMasteryPercent: 100,
      masteryPercent: null, evidenceCount: 0, status: 'sem_evidencia' as MasteryStatus, scoreSum: 0,
    }
    current.scoreSum += evidence.scoreSum
    current.evidenceCount += evidence.evidenceCount
    if (!current.description && evidence.description) current.description = evidence.description
    merged.set(rowKey, current)
  }

  return [...merged.values()].map(({ scoreSum, ...row }) => {
    const masteryPercent = row.evidenceCount ? Math.round((scoreSum / (row.evidenceCount * 10)) * 100) : null
    return { ...row, masteryPercent, status: masteryStatus(masteryPercent, row.evidenceCount) }
  }).sort((a, b) => a.academicYear - b.academicYear || a.bimester - b.bimester || a.subject.localeCompare(b.subject, 'pt-BR') || a.code.localeCompare(b.code))
}
