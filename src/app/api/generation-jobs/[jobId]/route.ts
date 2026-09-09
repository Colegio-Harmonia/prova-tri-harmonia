import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { generationJobs, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { cancelJob, retryJob } from '@/lib/queue/claim'

// Ações do usuário sobre um job da fila: cancelar (só 'pendente') e
// reenfileirar (só 'erro' — zera as tentativas). Dono do job ou
// coordenação/direção.

const bodySchema = z.object({ action: z.enum(['cancelar', 'reenfileirar']) })

export async function PATCH(req: NextRequest, props: { params: Promise<{ jobId: string }> }) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const routeParams = await props.params
  const jobId = Number(routeParams.jobId)
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return NextResponse.json({ error: 'Job inválido' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ação inválida', issues: parsed.error.issues }, { status: 400 })
  }

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  const job = await db.query.generationJobs.findFirst({ where: eq(generationJobs.id, jobId) })
  if (!job) return NextResponse.json({ error: 'Job não encontrado' }, { status: 404 })

  if (job.requestedBy !== currentUser.id && !isStaffSuperuser(currentUser.role)) {
    return NextResponse.json({ error: 'Sem permissão para alterar este job' }, { status: 403 })
  }

  if (parsed.data.action === 'cancelar') {
    const ok = await cancelJob(jobId)
    if (!ok) {
      return NextResponse.json({ error: 'Só é possível cancelar um job que ainda está pendente.' }, { status: 409 })
    }
    return NextResponse.json({ id: jobId, status: 'cancelado' })
  }

  const ok = await retryJob(jobId)
  if (!ok) {
    return NextResponse.json({ error: 'Só é possível reenfileirar um job que terminou em erro.' }, { status: 409 })
  }
  return NextResponse.json({ id: jobId, status: 'pendente' })
}
