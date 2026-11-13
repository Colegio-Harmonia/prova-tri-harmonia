/**
 * Fonte do Assistente: o Planejamento da Prova TRI é a referência; a planilha
 * só completa os bimestres que ainda não foram trazidos para cá.
 */
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { curriculumPlanAssignments, curriculumPlanSkills, curriculumPlanUnits, curriculumPlanVersions, curriculumPlans } from '@/db/schema'
import { isStaffSuperuser, type UserRole } from '@/lib/auth/roles'
import { buildCurriculumFromPlan, type PlanUnitRow } from '@/lib/curriculum/planCurriculum'
import { officialVersion, openVersion, PLANNING_STATUS_LABELS, type PlanningStatus } from '@/lib/curriculum/planningPolicy'
import type { CurriculumSelection, CurricularUnit, Segment } from '@/types/exam'
import { PLAN_ROW_OFFSET } from './rowOrigin'


export type AdvisorScope = { segment: Segment; gradeYear: number; subject: string }
export type BimesterSelection = { bimester: number; versionNumber: number; status: PlanningStatus; selection: CurriculumSelection }
export type AdvisorUnitOrigin = 'planejamento' | 'planilha'

export function bimesterNumberOf(period: string | null | undefined): number | null {
  const digits = period?.match(/\d+/)
  const value = digits ? Number(digits[0]) : NaN
  return value >= 1 && value <= 4 ? value : null
}

/** De onde veio cada unidade da seleção combinada (pelo rowIndex). */
export function unitOrigin(unit: Pick<CurricularUnit, 'rowIndex'>): AdvisorUnitOrigin {
  return unit.rowIndex >= PLAN_ROW_OFFSET ? 'planejamento' : 'planilha'
}

/**
 * Junta as duas fontes num plano do ano: bimestre que tem Planejamento usa o
 * Planejamento (a planilha desse bimestre é ignorada); os demais vêm da
 * planilha. `sheet` nulo = planilha indisponível para a disciplina.
 */
export function combineSources(scope: AdvisorScope, parts: BimesterSelection[], sheet: CurriculumSelection | null, notes: string[] = []): CurriculumSelection {
  const ordered = [...parts].sort((a, b) => a.bimester - b.bimester)
  const planned = new Set(ordered.map((part) => part.bimester))
  const fromPlans: CurricularUnit[] = ordered.flatMap((part) => part.selection.units.map((unit) => ({
    ...unit, rowIndex: part.bimester * PLAN_ROW_OFFSET + unit.rowIndex, bimestre: String(part.bimester),
  })))
  const fromSheet = (sheet?.units ?? []).filter((unit) => {
    const bimester = bimesterNumberOf(unit.bimestre)
    return bimester === null || !planned.has(bimester)
  })
  const sheetBimesters = [...new Set(fromSheet.map((unit) => bimesterNumberOf(unit.bimestre)))]

  // Ordem do ano: por bimestre; linhas da planilha sem bimestre reconhecível ficam no fim.
  const order = (unit: CurricularUnit) => bimesterNumberOf(unit.bimestre) ?? 99
  const units = [...fromPlans, ...fromSheet].map((unit, index) => ({ unit, index })).sort((a, b) => order(a.unit) - order(b.unit) || a.index - b.index).map((entry) => entry.unit)

  const labels: string[] = []
  if (ordered.length) labels.push(`Planejamento da Prova TRI (${ordered.map((part) => `${part.bimester}º bim., versão ${part.versionNumber} ${PLANNING_STATUS_LABELS[part.status].toLowerCase()}`).join('; ')})`)
  if (fromSheet.length && sheet) {
    const which = sheetBimesters.filter((value): value is number => value !== null).sort()
    labels.push(`planilha "${sheet.tabName}"${which.length ? ` (${which.map((value) => `${value}º`).join(', ')} bim.)` : ''}`)
  }

  return {
    ...scope,
    tabName: labels.join(' + ') || sheet?.tabName || 'sem origem',
    units,
    unmappedWarnings: [
      ...ordered.flatMap((part) => part.selection.unmappedWarnings),
      // Avisos da planilha só interessam para o que de fato veio dela.
      ...(fromSheet.length ? sheet?.unmappedWarnings ?? [] : []),
      ...notes,
    ],
  }
}

export type AdvisorViewer = { id: number; role: UserRole }

/**
 * Planejamentos internos da disciplina no ano letivo, um por bimestre.
 *
 * Quem pode ver o planejamento (coordenação/direção ou professor atribuído —
 * mesma regra de `canViewPlan`) lê a versão EM TRABALHO (rascunho/revisão)
 * quando existe, senão a oficial: o Assistente apoia quem está planejando e
 * precisa enxergar o que acabou de entrar no rascunho. Os demais professores
 * só leem a versão OFICIAL (aprovada/encerrada), que já é a referência pública
 * da escola na geração de provas; rascunho alheio nunca é exposto.
 */
export async function getBimesterPlanSelections(scope: AdvisorScope, academicYear: number, viewer: AdvisorViewer): Promise<BimesterSelection[]> {
  const plans = await db.select().from(curriculumPlans)
    .where(and(eq(curriculumPlans.academicYear, academicYear), eq(curriculumPlans.segment, scope.segment), eq(curriculumPlans.gradeYear, scope.gradeYear), eq(curriculumPlans.subject, scope.subject)))
    .orderBy(asc(curriculumPlans.bimester))
  if (!plans.length) return []
  const versions = await db.select({ id: curriculumPlanVersions.id, planId: curriculumPlanVersions.planId, versionNumber: curriculumPlanVersions.versionNumber, status: curriculumPlanVersions.status })
    .from(curriculumPlanVersions).where(inArray(curriculumPlanVersions.planId, plans.map((plan) => plan.id)))

  const assigned = isStaffSuperuser(viewer.role) ? null : new Set(
    (await db.select({ planId: curriculumPlanAssignments.planId }).from(curriculumPlanAssignments)
      .where(and(eq(curriculumPlanAssignments.userId, viewer.id), inArray(curriculumPlanAssignments.planId, plans.map((plan) => plan.id))))).map((row) => row.planId),
  )

  const parts: BimesterSelection[] = []
  for (const plan of plans) {
    const own = versions.filter((version) => version.planId === plan.id)
    const canSeeDraft = assigned === null || assigned.has(plan.id)
    const version = (canSeeDraft ? openVersion(own) : null) ?? officialVersion(own)
    if (!version) continue
    const units = await db.select().from(curriculumPlanUnits).where(eq(curriculumPlanUnits.versionId, version.id)).orderBy(asc(curriculumPlanUnits.position))
    // Planejamento criado e ainda vazio não substitui a planilha do bimestre.
    if (!units.length) continue
    const skills = await db.select().from(curriculumPlanSkills).where(inArray(curriculumPlanSkills.unitId, units.map((unit) => unit.id))).orderBy(asc(curriculumPlanSkills.position))
    const rows: PlanUnitRow[] = units.map((unit) => ({
      position: unit.position, title: unit.title, content: unit.content, objectives: unit.objectives, enemSkills: unit.enemSkills,
      skills: skills.filter((skill) => skill.unitId === unit.id).map((skill) => ({ code: skill.code, description: skill.description })),
    }))
    parts.push({
      bimester: plan.bimester, versionNumber: version.versionNumber, status: version.status,
      selection: buildCurriculumFromPlan({ ...scope, bimester: plan.bimester, academicYear }, `Planejamento interno #${plan.id}`, rows),
    })
  }
  return parts
}
