import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { curriculumPlans } from '@/db/schema'
import { CurriculumPlanError, getCurriculumFromPlan } from '@/lib/curriculum/planCurriculum'
import type { CurriculumSelection, Segment } from '@/types/exam'

/** Mantém rowIndex único ao juntar bimestres (cada planejamento numera suas unidades de 0). */
const ROW_OFFSET_PER_BIMESTER = 1000

export type BimesterSelection = { bimester: number; selection: CurriculumSelection }

/** Junta os planejamentos internos aprovados de cada bimestre num plano do ano. */
export function mergeBimesterSelections(
  scope: { segment: Segment; gradeYear: number; subject: string },
  parts: BimesterSelection[],
  extraWarnings: string[] = [],
): CurriculumSelection {
  const ordered = [...parts].sort((a, b) => a.bimester - b.bimester)
  return {
    ...scope,
    tabName: `Planejamento interno aprovado (${ordered.map((part) => `${part.bimester}º bimestre`).join(', ')})`,
    units: ordered.flatMap((part) => part.selection.units.map((unit) => ({
      ...unit,
      rowIndex: part.bimester * ROW_OFFSET_PER_BIMESTER + unit.rowIndex,
      bimestre: String(part.bimester),
    }))),
    unmappedWarnings: [...ordered.flatMap((part) => part.selection.unmappedWarnings), ...extraWarnings],
  }
}

/**
 * Plano do ano a partir do planejamento interno (`/planejamento`): usado
 * quando a disciplina não é lida da planilha (ex.: Inglês do EM, cuja aba é
 * ambígua). Considera o ano letivo mais recente com planejamento e só as
 * versões aprovadas. Devolve null quando não há nenhum planejamento aprovado.
 */
export async function getYearCurriculumFromInternalPlans(scope: { segment: Segment; gradeYear: number; subject: string }): Promise<CurriculumSelection | null> {
  const plans = await db.select().from(curriculumPlans)
    .where(and(eq(curriculumPlans.segment, scope.segment), eq(curriculumPlans.gradeYear, scope.gradeYear), eq(curriculumPlans.subject, scope.subject)))
    .orderBy(desc(curriculumPlans.academicYear), curriculumPlans.bimester)
  if (!plans.length) return null
  const academicYear = plans[0].academicYear

  const parts: BimesterSelection[] = []
  const skipped: string[] = []
  for (const plan of plans.filter((item) => item.academicYear === academicYear)) {
    try {
      const selection = await getCurriculumFromPlan(plan.id, { ...scope, bimester: plan.bimester, academicYear })
      parts.push({ bimester: plan.bimester, selection })
    } catch (error) {
      if (!(error instanceof CurriculumPlanError)) throw error
      skipped.push(`${plan.bimester}º bimestre fora da análise: ${error.message}`)
    }
  }
  return parts.length ? mergeBimesterSelections(scope, parts, skipped) : null
}
