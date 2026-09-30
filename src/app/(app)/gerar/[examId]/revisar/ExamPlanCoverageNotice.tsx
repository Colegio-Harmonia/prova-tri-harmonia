import Link from 'next/link'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { examPlanCoverage } from '@/lib/curriculum/operations'
import { findPlanForScope, plannedSkillsByPlan } from '@/lib/curriculum/operationsData'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

// Bloco 8.1 — aviso quando a prova não cobre habilidades planejadas do
// bimestre. Server component: não adiciona JavaScript à página de revisão.
export default async function ExamPlanCoverageNotice({ examId, userEmail }: { examId: number; userEmail: string | null | undefined }) {
  if (!userEmail || !Number.isInteger(examId)) return null
  try {
    const access = await authorizeExamAccess(examId, userEmail)
    if ('error' in access) return null
    const { exam } = access
    if (exam.examKind !== 'prova' || !exam.bimester) return null
    const plan = await findPlanForScope({ academicYear: exam.academicYear, segment: exam.segment, gradeYear: exam.gradeYear, subject: exam.subject, bimester: exam.bimester })
    if (!plan) return null
    const planned = (await plannedSkillsByPlan([plan.id])).get(plan.id) ?? []
    const questions = ((exam.generationPayload as ExamGenerationResult).questions ?? []).map((question) => question.bnccStatus === 'mapeado' && Array.isArray(question.bnccCodes) ? question.bnccCodes : [])
    const coverage = examPlanCoverage(planned, questions)
    if (!coverage.plannedCount) return null
    const complete = coverage.missing.length === 0
    return <aside role="note" className={`mb-4 rounded border p-3 text-sm ${complete ? 'border-status-success-border bg-status-success-surface text-status-success-content' : 'border-status-warning-border bg-status-warning-surface text-status-warning-content'}`}>
      <p className="font-semibold">{complete ? `Esta prova cobre as ${coverage.plannedCount} habilidades planejadas do ${exam.bimester}º bimestre.` : `Esta prova cobre ${coverage.covered.length} de ${coverage.plannedCount} habilidades planejadas do ${exam.bimester}º bimestre (${coverage.coveragePercent}%).`}</p>
      {!complete && <p className="mt-1">Não cobertas: {coverage.missing.map((skill) => skill.code).join(', ')}. Avalie em outra prova ou atividade para não chegar ao fim do bimestre sem evidência.</p>}
      {coverage.outsidePlan.length > 0 && <p className="mt-1 text-xs">Fora do planejamento: {coverage.outsidePlan.join(', ')}.</p>}
      <Link href={`/planejamento/${plan.id}`} className="mt-1 inline-block text-xs font-medium underline">Ver planejamento</Link>
    </aside>
  } catch (error) {
    console.warn('[revisar] cobertura do planejamento indisponível:', error instanceof Error ? error.message : error)
    return null
  }
}
