import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth/auth'
import { isStaffSuperuser } from '@/lib/auth/roles'
import PlanningImport from './planning-import'
import PlanningIndicators from './planning-indicators'
import PlanningList from './planning-list'

// Planejamento pedagógico (Bloco 7): a Prova TRI como fonte oficial do
// planejamento. Professores veem só os planejamentos atribuídos a eles.
export default async function PlanningPage(props: { searchParams: Promise<{ aba?: string }> }) {
  const session = await auth()
  if (!session?.user) redirect('/login')
  const isManager = isStaffSuperuser(session.user.role ?? '')
  const { aba } = await props.searchParams
  const tab = isManager && aba === 'importar' ? 'importar' : aba === 'indicadores' ? 'indicadores' : 'lista'
  const tabClass = (active: boolean) => `min-h-10 border-b-2 px-4 py-2 text-sm font-medium ${active ? 'border-harmonia-green text-content-primary' : 'border-transparent text-content-secondary hover:text-content-primary'}`
  return <div className="space-y-5">
    <div>
      <h1 className="text-lg font-semibold">Planejamento pedagógico</h1>
      <p className="mt-1 text-sm text-content-secondary">Crie, revise e aprove o planejamento de cada disciplina e bimestre. A versão aprovada é a referência para cobertura, domínio e relatórios.</p>
    </div>
    <nav aria-label="Seções do planejamento" className="flex gap-1 overflow-x-auto border-b border-border">
      <Link href="/planejamento" aria-current={tab === 'lista' ? 'page' : undefined} className={tabClass(tab === 'lista')}>Planejamentos</Link>
      <Link href="/planejamento?aba=indicadores" aria-current={tab === 'indicadores' ? 'page' : undefined} className={tabClass(tab === 'indicadores')}>Indicadores</Link>
      {isManager && <Link href="/planejamento?aba=importar" aria-current={tab === 'importar' ? 'page' : undefined} className={tabClass(tab === 'importar')}>Importar planilha</Link>}
    </nav>
    {tab === 'importar' ? <PlanningImport /> : tab === 'indicadores' ? <PlanningIndicators /> : <PlanningList isManager={isManager} />}
  </div>
}
