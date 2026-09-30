import { NextResponse } from 'next/server'
import { planDecisions } from '@/lib/curriculum/decisionLog'
import { OPERATION_RULES, suggestActions } from '@/lib/curriculum/operations'
import { interventionsForScope, loadScopeEvidence, plannedSkillsByPlan, skillSignals } from '@/lib/curriculum/operationsData'
import { idParam, withViewer } from '@/lib/curriculum/planningRoute'
import { getPlanDetail } from '@/lib/curriculum/planningService'

// Bloco 8.2–8.6 no contexto de um planejamento: cobertura do bimestre,
// aproveitamento da turma por habilidade, sugestões, intervenções e decisões.
export async function GET(_req: Request, { params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params
  return withViewer(async (viewer) => {
    const { plan } = await getPlanDetail(viewer, idParam(planId)) // aplica o controle de acesso
    const planned = (await plannedSkillsByPlan([plan.id])).get(plan.id) ?? []
    const evidence = await loadScopeEvidence({ academicYear: plan.academicYear, segment: plan.segment, gradeYear: plan.gradeYear, bimester: plan.bimester }, plan.subject)
    const signals = skillSignals(planned, evidence)
    const interventions = await interventionsForScope({ ...plan })
    const targeted = new Set(interventions.filter((item) => item.status !== 'concluida').flatMap((item) => item.skillCodes))
    return NextResponse.json({
      examCount: evidence.exams.length,
      signals,
      suggestions: suggestActions(signals, targeted),
      interventions,
      decisions: await planDecisions(plan.id),
      rules: OPERATION_RULES,
    })
  })
}
