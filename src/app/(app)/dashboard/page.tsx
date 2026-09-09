import { auth } from '@/auth/auth'
import { isStaffSuperuser } from '@/lib/auth/roles'
import DashboardStats from './DashboardStats'
import EnemDashboard from './EnemDashboard'
import ProfessorHome from './ProfessorHome'

export default async function DashboardPage() {
  const session = await auth()

  // Professor cai direto nas turmas/provas dele (Subtarefa 7) — as
  // métricas do colégio inteiro abaixo são só pra coordenação/direção.
  if (!isStaffSuperuser(session?.user?.role ?? '')) {
    return <ProfessorHome />
  }

  return (
    <div>
      <h1 className="text-lg font-semibold">Dashboard</h1>
      <p className="mt-1 text-sm text-neutral-500">Visão geral das provas geradas e banco de questões ENEM.</p>

      <div className="mt-6">
        <DashboardStats />
      </div>

      <hr className="my-8 border-neutral-200" />

      <EnemDashboard />
    </div>
  )
}
