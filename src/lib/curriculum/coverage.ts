export type PlannedSkill = { code: string; description: string | null }
export type CoverageQuestion = {
  key: string
  codes: string[]
  evaluatedAnswerCount: number
}

export type CoverageStatus = 'planejada_avaliada' | 'planejada_nao_avaliada' | 'fora_planejamento'

export type CoverageSkillRow = {
  code: string
  description: string | null
  status: CoverageStatus
  planned: boolean
  itemCount: number
  evaluatedAnswerCount: number
}

export type CurriculumCoverage = {
  rows: CoverageSkillRow[]
  plannedSkillCount: number
  assessedPlannedSkillCount: number
  pendingPlannedSkillCount: number
  outsidePlanSkillCount: number
  mappedItemCount: number
  unmappedItemCount: number
  unmappedEvaluatedAnswerCount: number
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase()
}

export function calculateCurriculumCoverage(
  plannedSkills: PlannedSkill[],
  questions: CoverageQuestion[],
): CurriculumCoverage {
  const planned = new Map<string, PlannedSkill>()
  for (const skill of plannedSkills) {
    const code = normalizeCode(skill.code)
    if (code && !planned.has(code)) planned.set(code, { code, description: skill.description })
  }

  const evidence = new Map<string, { itemKeys: Set<string>; evaluatedAnswerCount: number }>()
  let unmappedItemCount = 0
  let unmappedEvaluatedAnswerCount = 0
  const mappedItemKeys = new Set<string>()

  for (const question of questions) {
    const codes = [...new Set(question.codes.map(normalizeCode).filter(Boolean))]
    if (codes.length === 0) {
      unmappedItemCount++
      unmappedEvaluatedAnswerCount += question.evaluatedAnswerCount
      continue
    }
    mappedItemKeys.add(question.key)
    for (const code of codes) {
      const current = evidence.get(code) ?? { itemKeys: new Set<string>(), evaluatedAnswerCount: 0 }
      current.itemKeys.add(question.key)
      current.evaluatedAnswerCount += question.evaluatedAnswerCount
      evidence.set(code, current)
    }
  }

  const allCodes = new Set([...planned.keys(), ...evidence.keys()])
  const rows = [...allCodes].map((code): CoverageSkillRow => {
    const plan = planned.get(code)
    const observed = evidence.get(code)
    const evaluatedAnswerCount = observed?.evaluatedAnswerCount ?? 0
    return {
      code,
      description: plan?.description ?? null,
      planned: Boolean(plan),
      itemCount: observed?.itemKeys.size ?? 0,
      evaluatedAnswerCount,
      status: plan
        ? evaluatedAnswerCount > 0 ? 'planejada_avaliada' : 'planejada_nao_avaliada'
        : 'fora_planejamento',
    }
  }).sort((a, b) => a.status.localeCompare(b.status) || a.code.localeCompare(b.code))

  const assessedPlannedSkillCount = rows.filter((row) => row.status === 'planejada_avaliada').length
  const pendingPlannedSkillCount = rows.filter((row) => row.status === 'planejada_nao_avaliada').length
  const outsidePlanSkillCount = rows.filter((row) => row.status === 'fora_planejamento').length

  return {
    rows,
    plannedSkillCount: planned.size,
    assessedPlannedSkillCount,
    pendingPlannedSkillCount,
    outsidePlanSkillCount,
    mappedItemCount: mappedItemKeys.size,
    unmappedItemCount,
    unmappedEvaluatedAnswerCount,
  }
}
