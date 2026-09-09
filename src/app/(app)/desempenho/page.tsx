import { auth } from '@/auth/auth'
import { isStaffSuperuser } from '@/lib/auth/roles'
import DesempenhoPanel from './DesempenhoPanel'

export default async function DesempenhoPage() {
  const session = await auth()
  const isSuperuser = isStaffSuperuser(session?.user?.role ?? '')

  return (
    <div>
      <h1 className="text-lg font-semibold">Desempenho</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {isSuperuser ? 'Desempenho dos alunos em todas as provas corrigidas do colégio.' : 'Desempenho dos alunos nas suas provas corrigidas.'}
      </p>

      <div className="mt-6">
        <DesempenhoPanel isSuperuser={isSuperuser} />
      </div>
    </div>
  )
}
