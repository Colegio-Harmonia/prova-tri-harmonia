import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { auth } from '@/auth/auth'
import { SEGMENT_LABELS } from '@/config/subjects'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { PLANNING_STATUS_LABELS } from '@/lib/curriculum/planningPolicy'
import { getPlanDetail, PlanningError } from '@/lib/curriculum/planningService'
import type { Segment } from '@/types/exam'
import PrintButton from './print-button'

// Versão para impressão / "Salvar como PDF" do planejamento.
export default async function PrintPlanPage(props: { params: Promise<{ planId: string }>; searchParams: Promise<{ versionId?: string }> }) {
  const session = await auth()
  if (!session?.user?.email) redirect('/login')
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!user) redirect('/login')
  const { planId } = await props.params
  const { versionId } = await props.searchParams
  let detail
  try {
    detail = await getPlanDetail({ id: user.id, role: user.role }, Number(planId), versionId ? Number(versionId) : undefined)
  } catch (error) {
    return <p className="text-sm text-content-secondary">{error instanceof PlanningError ? error.message : 'Não foi possível abrir o planejamento.'}</p>
  }
  const version = detail.versions.find((item) => item.id === detail.selectedVersionId)
  const approval = detail.history.find((item) => item.versionId === version?.id && item.toStatus === 'aprovado')
  const { plan } = detail
  return <article className="print-report mx-auto max-w-4xl space-y-5 bg-surface p-6 text-content-primary">
    <div className="flex justify-end print:hidden"><PrintButton /></div>
    <header className="border-b border-border pb-3">
      <p className="text-sm font-semibold">Colégio Harmonia · Planejamento pedagógico</p>
      <h1 className="mt-1 text-2xl font-bold">{plan.subject} · {plan.gradeYear}º ano · {plan.bimester}º bimestre de {plan.academicYear}</h1>
      <p className="mt-1 text-sm text-content-secondary">{SEGMENT_LABELS[plan.segment as Segment]} · Versão {version?.versionNumber ?? '—'} ({version ? PLANNING_STATUS_LABELS[version.status] : '—'}){approval ? ` · aprovada por ${approval.changedBy} em ${approval.createdAt.toLocaleDateString('pt-BR')}` : ''}</p>
      <p className="mt-1 text-sm text-content-secondary">Responsáveis: {detail.assignments.map((person) => person.name).join(', ') || '—'}</p>
    </header>
    {detail.units.map((unit, index) => <section key={index} className="print-avoid-break">
      <h2 className="text-lg font-semibold">{index + 1}. {unit.title}</h2>
      {unit.content && <p className="mt-1 whitespace-pre-line text-sm"><span className="font-semibold">Conteúdos:</span> {unit.content}</p>}
      {unit.objectives && <p className="mt-1 whitespace-pre-line text-sm"><span className="font-semibold">Objetivos:</span> {unit.objectives}</p>}
      {unit.skills.length > 0 && <table className="mt-2 w-full border-collapse text-sm">
        <thead><tr className="text-left"><th scope="col" className="border border-border px-2 py-1">Código</th><th scope="col" className="border border-border px-2 py-1">Habilidade BNCC</th><th scope="col" className="border border-border px-2 py-1">Meta</th></tr></thead>
        <tbody>{unit.skills.map((skill) => <tr key={skill.code}><td className="border border-border px-2 py-1 font-mono">{skill.code}</td><td className="border border-border px-2 py-1">{skill.description ?? '—'}</td><td className="border border-border px-2 py-1 text-right">{skill.targetMasteryPercent}%</td></tr>)}</tbody>
      </table>}
    </section>)}
    {!detail.units.length && <p className="text-sm text-content-secondary">Esta versão ainda não tem unidades.</p>}
    <footer className="border-t border-border pt-2 text-xs text-content-muted">Gerado pela Prova TRI em {new Date().toLocaleDateString('pt-BR')}.</footer>
  </article>
}
