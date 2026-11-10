import type { CurricularUnit } from '@/types/exam'

export type TargetSkill = { code: string; description: string | null }

/**
 * Habilidade BNCC-alvo de uma questão. A BNCC é o eixo da geração: cada
 * questão nasce para medir UMA habilidade, escolhida de forma determinística
 * (e não deixada à sorte do modelo) para cobrir as habilidades do capítulo.
 *
 * - `forcedCodes` (atividade BNCC, substituição de questão): respeita o código.
 * - caso contrário, distribui as habilidades mapeadas do capítulo em rodízio
 *   pela posição da questão dentro do capítulo.
 */
export function pickTargetSkills(params: {
  unit: CurricularUnit
  slotIndexInUnit: number
  forcedCodes?: string[]
  descriptions?: ReadonlyMap<string, string>
}): TargetSkill[] {
  const mapped = params.unit.habilidades.status === 'mapeado' ? params.unit.habilidades.skills : []
  const describe = (skill: { code: string; description: string | null }): TargetSkill => ({
    code: skill.code.toUpperCase(),
    description: skill.description?.trim() || params.descriptions?.get(skill.code.toUpperCase()) || null,
  })
  const forced = (params.forcedCodes ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean)
  if (forced.length) {
    return forced.map((code) => describe(mapped.find((skill) => skill.code.toUpperCase() === code) ?? { code, description: null }))
  }
  if (!mapped.length) return []
  return [describe(mapped[Math.max(0, params.slotIndexInUnit) % mapped.length]!)]
}

/** Objetivos cognitivos (nunca os atitudinais) do capítulo, para calibrar a exigência. */
export function cognitiveObjectives(unit: CurricularUnit): string[] {
  return unit.objetivos.filter((objective) => objective.kind === 'cognitiva').map((objective) => objective.text.trim()).filter(Boolean)
}

export type TargetEnemSkill = { code: string; description: string | null }

/**
 * Habilidade ENEM-alvo (Ensino Médio planejado pela Matriz do ENEM, coluna
 * "Habilidades ENEM"). Escolhida por código — nunca pela IA — com rodízio
 * ponderado suave pelo peso do planejamento (quantas vezes o código aparece
 * no material): as mais frequentes recebem mais questões, e a sequência é
 * determinística pela posição da questão dentro do capítulo. Ex.: pesos
 * H5×8, H7×1, H18×1, H21×1 → H5, H5, H7, H5, H5, H18, …
 */
export function pickTargetEnemSkill(params: { unit: CurricularUnit; slotIndexInUnit: number; forcedCode?: string }): TargetEnemSkill | null {
  const skills = params.unit.enemSkills?.skills ?? []
  if (!skills.length && !params.forcedCode) return null
  // Substituição de questão: mantém a habilidade da original se ela é do capítulo.
  const forced = params.forcedCode ? skills.find((skill) => skill.code === params.forcedCode) : undefined
  if (params.forcedCode && !forced) throw new Error(`A habilidade ENEM ${params.forcedCode} não pertence à unidade original. Atualize explicitamente o recorte antes de substituir a questão.`)
  if (forced) return { code: forced.code, description: forced.description }
  const total = skills.reduce((sum, skill) => sum + skill.count, 0)
  const current = skills.map(() => 0)
  let picked = 0
  for (let step = 0; step <= Math.max(0, params.slotIndexInUnit); step++) {
    skills.forEach((skill, index) => { current[index]! += skill.count })
    picked = current.reduce((best, value, index) => (value > current[best]! ? index : best), 0)
    current[picked]! -= total
  }
  const skill = skills[picked]!
  return { code: skill.code, description: skill.description }
}
