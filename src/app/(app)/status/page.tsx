import { Suspense } from 'react'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import StatusTabs from './StatusTabs'

export default async function StatusPage() {
  const session = await auth()
  const currentUser = session?.user?.email
    ? await db.query.users.findFirst({ where: eq(users.email, session.user.email), columns: { id: true, role: true } })
    : null

  const isSuperuser = isStaffSuperuser(currentUser?.role ?? '')

  return (
    <div>
      <h1 className="text-lg font-semibold">Provas</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {isSuperuser ? 'Andamento de todas as provas em produção e da fila de geração.' : 'Suas provas atribuídas e sua fila de geração.'}
      </p>
      <div className="mt-6">
        {/* Suspense obrigatório: StatusTabs usa useSearchParams (?aba=fila). */}
        <Suspense fallback={<p className="text-sm text-neutral-500">Carregando…</p>}>
          <StatusTabs currentUserId={currentUser?.id ?? null} isSuperuser={isSuperuser} examKind="prova" basePath="/status" />
        </Suspense>
      </div>
    </div>
  )
}
