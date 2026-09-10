import CurriculumPreview from './CurriculumPreview'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { isStaffSuperuser } from '@/lib/auth/roles'

export default async function GerarPage() {
  const session = await auth()
  const currentUser = session?.user?.email
    ? await db.query.users.findFirst({ where: eq(users.email, session.user.email), columns: { role: true } })
    : null
  const teacherOptions = currentUser && isStaffSuperuser(currentUser.role)
    ? await db.query.users.findMany({ where: (table, { and, eq }) => and(eq(table.active, true), eq(table.role, 'professor')), columns: { id: true, name: true, email: true } })
    : []
  return (
    <div>
      <h1 className="text-lg font-semibold">Gerar prova</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Escolha segmento, ano e uma ou mais disciplinas — cada disciplina vira uma prova na fila de geração, sem travar sua navegação.
      </p>
      <div className="mt-6">
        <CurriculumPreview coordinator={Boolean(currentUser && isStaffSuperuser(currentUser.role))} teachers={teacherOptions} />
      </div>
    </div>
  )
}
