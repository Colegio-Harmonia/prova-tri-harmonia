import { Suspense } from 'react'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import ReforcoTabs from './ReforcoTabs'

export default async function ReforcoPage() {
  const session = await auth()
  const currentUser = session?.user?.email
    ? await db.query.users.findFirst({ where: eq(users.email, session.user.email), columns: { id: true, role: true } })
    : null
  const isSuperuser = isStaffSuperuser(currentUser?.role ?? '')

  return (
    <div>
      <h1 className="text-lg font-semibold text-content-primary">Reforço ENEM</h1>
      <p className="mt-1 text-sm text-content-secondary">
        Treino para Ensino Médio focado em habilidades INEP (H1-H30), montado com questões reais ENEM — com gabarito comentado e mapa da atividade.
      </p>
      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-content-secondary">Carregando…</p>}>
          <ReforcoTabs currentUserId={currentUser?.id ?? null} isSuperuser={isSuperuser} />
        </Suspense>
      </div>
    </div>
  )
}
