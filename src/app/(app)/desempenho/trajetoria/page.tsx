import Link from 'next/link'
import TrajectorySection from '@/components/trajectory/TrajectorySection'

// Bloco 6 — trajetória anual da turma. O escopo de acesso é aplicado na API
// (professor só vê as provas atribuídas a ele).
export default async function ClassTrajectoryPage(props: { searchParams: Promise<{ classroomCourseId?: string; turma?: string; academicYear?: string }> }) {
  const { classroomCourseId, turma, academicYear } = await props.searchParams
  if (!classroomCourseId) return <p className="text-sm text-content-secondary">Abra a trajetória a partir de uma turma em <Link href="/turmas" className="underline">Turmas</Link>.</p>
  const query = new URLSearchParams({ classroomCourseId, ...(academicYear ? { academicYear } : {}) }).toString()
  return <article className="print-report mx-auto max-w-4xl space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
      <Link href={`/turmas/${encodeURIComponent(classroomCourseId)}`} className="text-sm text-content-secondary underline">← Voltar para a turma</Link>
    </div>
    <header>
      <p className="text-sm font-semibold text-harmonia-green">Trajetória anual da turma</p>
      <h1 className="mt-1 text-2xl font-bold text-content-primary">{turma ?? 'Turma'}</h1>
      <p className="mt-2 text-sm text-content-secondary">Baseado apenas em correções revisadas. Compara bimestres, separa evolução real de mudança no conteúdo avaliado e mostra a cobertura do planejamento.</p>
    </header>
    <TrajectorySection query={query} title="Evolução da turma ao longo do ano" />
  </article>
}
