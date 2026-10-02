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
