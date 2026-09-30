import { NextRequest, NextResponse } from 'next/server'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { canonicalSubject } from '@/lib/curriculum/masteryData'
import { groupIndicators, summarizeIndicators, type PlanIndicatorInput } from '@/lib/curriculum/operations'
import { loadScopeEvidence, plannedSkillsByPlan } from '@/lib/curriculum/operationsData'
import { withViewer } from '@/lib/curriculum/planningRoute'
import { listPlans } from '@/lib/curriculum/planningService'
import { calculateCurriculumCoverage } from '@/lib/curriculum/coverage'
import { db } from '@/db/client'
import { pedagogicalInterventions } from '@/db/schema'
import { eq } from 'drizzle-orm'

const SEGMENT_LABEL: Record<string, string> = { 'anos-iniciais': 'Anos iniciais', 'anos-finais': 'Anos finais', 'ensino-medio': 'Ensino médio' }

// Bloco 8.5: indicadores do ano. Professor: os próprios planejamentos.
// Coordenação/direção: escola inteira, por segmento e por disciplina.
export async function GET(req: NextRequest) {
  return withViewer(async (viewer) => {
    const academicYear = Number(req.nextUrl.searchParams.get('academicYear')) || new Date().getFullYear()
    const plans = await listPlans(viewer, { academicYear })
    const skills = await plannedSkillsByPlan(plans.map((plan) => plan.id))
    const evidence = plans.length ? await loadScopeEvidence({ academicYear }) : null
    const interventions = await db.select().from(pedagogicalInterventions).where(eq(pedagogicalInterventions.academicYear, academicYear))
    const inputs: PlanIndicatorInput[] = plans.map((plan) => {
      const planned = skills.get(plan.id) ?? []
      const scopeExams = evidence?.exams.filter((exam) => exam.segment === plan.segment && exam.gradeYear === plan.gradeYear && exam.bimester === plan.bimester && canonicalSubject(exam.subject) === canonicalSubject(plan.subject)) ?? []
      const coverage = calculateCurriculumCoverage(planned, evidence ? evidence.questions(scopeExams) : [])
      return {
        planId: plan.id, academicYear: plan.academicYear, segment: plan.segment, gradeYear: plan.gradeYear, subject: plan.subject, bimester: plan.bimester,
        officialStatus: (plan.official?.status as 'aprovado' | 'encerrado' | undefined) ?? null,
        openStatus: (plan.open?.status as 'rascunho' | 'em_revisao' | undefined) ?? null,
        plannedCount: coverage.plannedSkillCount, evaluatedCount: coverage.assessedPlannedSkillCount,
        interventions: interventions.filter((item) => item.segment === plan.segment && item.gradeYear === plan.gradeYear && canonicalSubject(item.subject) === canonicalSubject(plan.subject) && (item.bimester === null || item.bimester === plan.bimester))
          .map((item) => ({ status: item.status, dueDate: item.dueDate })),
      }
    })
    const today = new Date().toISOString().slice(0, 10)
    const manager = isStaffSuperuser(viewer.role)
    return NextResponse.json({
      academicYear,
      scope: manager ? 'escola' : 'professor',
      summary: summarizeIndicators(inputs, today),
      bySegment: manager ? groupIndicators(inputs, today, (plan) => SEGMENT_LABEL[plan.segment] ?? plan.segment) : [],
      bySubject: groupIndicators(inputs, today, (plan) => plan.subject),
      plans: inputs.map((plan) => ({ ...plan, coveragePercent: plan.plannedCount ? Math.round((plan.evaluatedCount / plan.plannedCount) * 100) : null })),
    })
  })
}
