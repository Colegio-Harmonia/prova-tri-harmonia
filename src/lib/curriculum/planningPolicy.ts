import type { UserRole } from '@/lib/auth/roles'
import { isStaffSuperuser } from '@/lib/auth/roles'

export const PLANNING_STATUSES = ['rascunho', 'em_revisao', 'aprovado', 'encerrado'] as const
export type PlanningStatus = (typeof PLANNING_STATUSES)[number]

type AccessContext = { role: UserRole; userId: number; assignedUserIds?: readonly number[] }

export function canViewPlan(context: AccessContext) {
  return isStaffSuperuser(context.role) || context.assignedUserIds?.includes(context.userId) === true
}

export function canEditPlan(context: AccessContext, status: PlanningStatus) {
  if (status !== 'rascunho') return false
  return isStaffSuperuser(context.role) || context.assignedUserIds?.includes(context.userId) === true
}

export function canTransitionPlan(context: AccessContext, from: PlanningStatus, to: PlanningStatus) {
  if (from === 'rascunho' && to === 'em_revisao') return canEditPlan(context, from)
  if (!isStaffSuperuser(context.role)) return false
  return (from === 'em_revisao' && (to === 'rascunho' || to === 'aprovado')) || (from === 'aprovado' && to === 'encerrado')
}

export function validatePlanScope(input: { academicYear: number; gradeYear: number; bimester: number; subject: string }) {
  if (!Number.isInteger(input.academicYear) || input.academicYear < 2020 || input.academicYear > 2100) return 'Ano letivo inválido.'
  if (!Number.isInteger(input.gradeYear) || input.gradeYear < 1 || input.gradeYear > 9) return 'Série inválida.'
  if (!Number.isInteger(input.bimester) || input.bimester < 1 || input.bimester > 4) return 'Bimestre inválido.'
  if (!input.subject.trim()) return 'Disciplina obrigatória.'
  return null
}

export function planCopyDraft(source: { versionId: number; academicYear: number; status: PlanningStatus }, targetAcademicYear: number) {
  if (source.status !== 'aprovado' && source.status !== 'encerrado') throw new Error('Somente planejamento aprovado ou encerrado pode ser copiado.')
  if (!Number.isInteger(targetAcademicYear) || targetAcademicYear <= source.academicYear) throw new Error('O ano de destino deve ser posterior ao planejamento de origem.')
  return { academicYear: targetAcademicYear, status: 'rascunho' as const, source: 'copia' as const, copiedFromVersionId: source.versionId }
}

// ── Bloco 7: versões, travas e conteúdo editável ─────────────────────

export const PLANNING_STATUS_LABELS: Record<PlanningStatus, string> = {
  rascunho: 'Rascunho',
  em_revisao: 'Em revisão',
  aprovado: 'Aprovado',
  encerrado: 'Encerrado',
}

type VersionLike = { id: number; versionNumber: number; status: PlanningStatus }

/** Versão oficial: a aprovada/encerrada mais recente. Rascunhos e revisões não valem até aprovar. */
export function officialVersion<T extends VersionLike>(versions: T[]): T | null {
  return versions.filter((version) => version.status === 'aprovado' || version.status === 'encerrado')
    .sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null
}

/** Versão em trabalho (rascunho ou em revisão). Só pode existir uma por planejamento. */
export function openVersion<T extends VersionLike>(versions: T[]): T | null {
  return versions.filter((version) => version.status === 'rascunho' || version.status === 'em_revisao')
    .sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null
}

/**
 * Nova versão (alteração de um planejamento já aprovado). Aprovado e
 * encerrado nunca são editados diretamente: a mudança vira nova versão, que
 * passa por revisão. Depois do encerramento do bimestre, só a gestão pode
 * abrir nova versão, e com justificativa registrada.
 */
export function canStartNewVersion(context: AccessContext, versions: VersionLike[], note?: string | null): { ok: true } | { ok: false; reason: string } {
  if (!canViewPlan(context)) return { ok: false, reason: 'Sem acesso a este planejamento.' }
  if (openVersion(versions)) return { ok: false, reason: 'Já existe uma versão em rascunho ou em revisão. Conclua-a antes de abrir outra.' }
  const official = officialVersion(versions)
  if (official?.status === 'encerrado') {
    if (!isStaffSuperuser(context.role)) return { ok: false, reason: 'O bimestre foi encerrado: só a coordenação ou a direção pode abrir nova versão.' }
    if (!note?.trim()) return { ok: false, reason: 'Informe a justificativa para alterar um planejamento de bimestre encerrado.' }
  }
  return { ok: true }
}

/** Importação/cópia só criam versão quando não há outra em trabalho. */
export function canReceiveNewDraft(versions: VersionLike[]) {
  return openVersion(versions) === null
}

export const BNCC_CODE_PATTERN = /^(EF\d{2}[A-Z]{2}\d{2}|EM13[A-Z]{3}\d{3}|EI\d{2}[A-Z]{2}\d{2})$/

export type PlanUnitInput = {
  title: string
  content?: string | null
  objectives?: string | null
  skills: Array<{ code: string; description?: string | null; targetMasteryPercent?: number }>
}

export type NormalizedPlanUnit = {
  title: string
  content: string | null
  objectives: string | null
  skills: Array<{ code: string; description: string | null; targetMasteryPercent: number }>
}

/** Normaliza e valida o conteúdo editado. Devolve a lista de problemas, sem salvar nada parcial. */
export function normalizePlanUnits(units: PlanUnitInput[]): { units: NormalizedPlanUnit[]; errors: string[] } {
  const errors: string[] = []
  const normalized = units.map((unit, index) => {
    const title = unit.title?.trim() ?? ''
    if (!title) errors.push(`Unidade ${index + 1}: informe o título.`)
    const seen = new Set<string>()
    const skills = (unit.skills ?? []).map((skill) => {
      const code = skill.code.trim().toUpperCase()
      if (!BNCC_CODE_PATTERN.test(code)) errors.push(`Unidade ${index + 1}: código BNCC inválido "${skill.code.trim()}".`)
      if (seen.has(code)) errors.push(`Unidade ${index + 1}: habilidade ${code} repetida.`)
      seen.add(code)
      const target = skill.targetMasteryPercent ?? 100
      if (!Number.isInteger(target) || target < 0 || target > 100) errors.push(`Unidade ${index + 1}: meta de ${code} deve ser de 0 a 100.`)
      return { code, description: skill.description?.trim() || null, targetMasteryPercent: target }
    }).filter((skill) => skill.code)
    return { title, content: unit.content?.trim() || null, objectives: unit.objectives?.trim() || null, skills }
  })
  return { units: normalized, errors }
}
