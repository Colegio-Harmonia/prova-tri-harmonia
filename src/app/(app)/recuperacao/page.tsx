import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import RecuperacaoHome from './RecuperacaoHome'

export default async function RecuperacaoPage() {
  const session = await auth()
  const currentUser = session?.user?.email
    ? await db.query.users.findFirst({ where: eq(users.email, session.user.email), columns: { role: true } })
    : null
  return (
    <div>
      <h1 className="text-lg font-semibold text-content-primary">Recuperação</h1>
      <p className="mt-1 text-sm text-content-secondary">
        Provas individuais com as habilidades em que cada aluno ficou abaixo de 60%. Abra um lote pela página da turma, marque os alunos, revise e envie para a coordenação. Depois de aprovado, o lote entra na fila de impressão da sala.
      </p>
      <div className="mt-6"><RecuperacaoHome isSuperuser={isStaffSuperuser(currentUser?.role ?? '')} /></div>
    </div>
  )
}
