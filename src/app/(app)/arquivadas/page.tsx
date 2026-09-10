import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import StatusList from '../status/StatusList'

export default async function ArquivadasPage() {
  const session = await auth()
  const currentUser = session?.user?.email
    ? await db.query.users.findFirst({ where: eq(users.email, session.user.email), columns: { id: true, role: true } })
    : null
  return <div>
    <h1 className="text-lg font-semibold">Provas arquivadas</h1>
    <p className="mt-1 text-sm text-neutral-500">Arquivo compartilhado: uma prova arquivada fica oculta tanto para o professor quanto para a secretaria.</p>
    <div className="mt-6"><StatusList currentUserId={currentUser?.id ?? null} isCoordenacao={isStaffSuperuser(currentUser?.role ?? '')} examKind="prova" archivedOnly /></div>
  </div>
}
