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
