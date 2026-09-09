import { Suspense } from 'react'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import AtividadesTabs from './AtividadesTabs'

export default async function AtividadesPage() {
  const session = await auth()
  const currentUser = session?.user?.email
    ? await db.query.users.findFirst({ where: eq(users.email, session.user.email), columns: { id: true, role: true } })
    : null
  return (
    <div>
      <h1 className="text-lg font-semibold text-content-primary">Atividades</h1>
      <p className="mt-1 text-sm text-content-secondary">Atividades formativas para Educação Básica, alinhadas à BNCC e publicáveis no Google Classroom.</p>
      <div className="mt-6"><Suspense fallback={<p className="text-sm text-content-secondary">Carregando…</p>}><AtividadesTabs currentUserId={currentUser?.id ?? null} isSuperuser={isStaffSuperuser(currentUser?.role ?? '')} /></Suspense></div>
    </div>
  )
}
