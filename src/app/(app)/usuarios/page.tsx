import { redirect } from 'next/navigation'
import { auth } from '@/auth/auth'
import { isStaffSuperuser } from '@/lib/auth/roles'
import UsuariosList from './UsuariosList'

export default async function UsuariosPage() {
  const session = await auth()
  if (!isStaffSuperuser(session?.user?.role ?? '')) redirect('/dashboard')

  return (
    <div>
      <h1 className="text-lg font-semibold">Usuários</h1>
      <p className="mt-1 text-sm text-neutral-500">Contas com acesso ao Prova-TRI — só e-mails @colegioharmonia.com.br.</p>

      <div className="mt-6">
        <UsuariosList />
      </div>
    </div>
  )
}
