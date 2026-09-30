import { redirect } from 'next/navigation'
import { auth } from '@/auth/auth'
import { isStaffSuperuser } from '@/lib/auth/roles'
import PlanningImport from './planning-import'

export default async function PlanningPage() {
  const session = await auth()
  if (!isStaffSuperuser(session?.user?.role ?? '')) redirect('/dashboard')
  return <div><h1 className="text-lg font-semibold">Planejamento pedagógico</h1><p className="mt-1 text-sm text-content-secondary">Confira e versione o planejamento das planilhas oficiais.</p><PlanningImport /></div>
}
