import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { curriculumPlans, curriculumPlanVersions, curriculumPlanUnits, curriculumPlanSkills } from '@/db/schema'
import { canonicalSubject } from '@/lib/curriculum/masteryData'
import type { Segment } from '@/types/exam'

export type ManualPlanningGuide = {
  unavailable?: boolean
  plans: Array<{
    id: number; bimester: number
    units: Array<{ id: number; title: string; content: string | null; objectives: string | null; skills: Array<{ code: string; description: string | null }> }>
  }>
}

/** Read only approved versions in the exam's exact school year, segment and grade. */
export async function loadManualPlanningGuide(scope: { academicYear: number; segment: Segment; gradeYear: number; subject: string }): Promise<ManualPlanningGuide> {
  const plans = (await db.select().from(curriculumPlans).where(and(
    eq(curriculumPlans.academicYear, scope.academicYear), eq(curriculumPlans.segment, scope.segment), eq(curriculumPlans.gradeYear, scope.gradeYear),
  )).orderBy(asc(curriculumPlans.bimester))).filter((plan) => canonicalSubject(plan.subject) === canonicalSubject(scope.subject))
  if (!plans.length) return { plans: [] }
  const versions = await db.select().from(curriculumPlanVersions).where(and(
    inArray(curriculumPlanVersions.planId, plans.map((plan) => plan.id)), eq(curriculumPlanVersions.status, 'aprovado'),
  )).orderBy(desc(curriculumPlanVersions.versionNumber))
  const selected = plans.flatMap((plan) => {
    const version = versions.find((candidate) => candidate.planId === plan.id)
    return version ? [{ plan, version }] : []
  })
  if (!selected.length) return { plans: [] }
  const units = await db.select().from(curriculumPlanUnits).where(inArray(curriculumPlanUnits.versionId, selected.map(({ version }) => version.id))).orderBy(asc(curriculumPlanUnits.position))
  const skills = units.length ? await db.select().from(curriculumPlanSkills).where(inArray(curriculumPlanSkills.unitId, units.map((unit) => unit.id))).orderBy(asc(curriculumPlanSkills.position)) : []
  return { plans: selected.map(({ plan, version }) => ({
    id: plan.id, bimester: plan.bimester,
    units: units.filter((unit) => unit.versionId === version.id).map((unit) => ({
      id: unit.id, title: unit.title, content: unit.content, objectives: unit.objectives,
      skills: skills.filter((skill) => skill.unitId === unit.id).map(({ code, description }) => ({ code, description })),
    })),
  })) }
}
