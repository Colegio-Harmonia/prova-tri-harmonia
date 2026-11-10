import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { generationJobs, users } from '@/db/schema'
import { generationJobItems } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { cancelJob, retryJob, retryPartialJob } from '@/lib/queue/claim'

// Ações do usuário sobre um job da fila: cancelar, reenfileirar ou repetir a
// configuração de uma prova concluída. Dono do job ou coordenação/direção.

const bodySchema = z.object({ action: z.enum(['cancelar', 'reenfileirar', 'retomar_pendentes', 'repetir']) })

export async function GET(_req: NextRequest, props: { params: Promise<{ jobId: string }> }) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const jobId = Number((await props.params).jobId)
  if (!Number.isSafeInteger(jobId) || jobId <= 0) return NextResponse.json({ error: 'Job inválido' }, { status: 400 })
  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })
  const job = await db.query.generationJobs.findFirst({ where: eq(generationJobs.id, jobId) })
  if (!job) return NextResponse.json({ error: 'Job não encontrado' }, { status: 404 })
  if (job.requestedBy !== currentUser.id && !isStaffSuperuser(currentUser.role)) return NextResponse.json({ error: 'Sem permissão para consultar este job' }, { status: 403 })
  const items = await db.select({ slotNumber: generationJobItems.slotNumber, status: generationJobItems.status, currentStage: generationJobItems.currentStage, lastError: generationJobItems.lastError })
    .from(generationJobItems)
    .where(eq(generationJobItems.jobId, jobId))
  return NextResponse.json({ id: job.id, jobType: job.jobType, status: job.status, errorMessage: job.errorMessage, resultExamId: job.resultExamId, resultRef: job.resultRef, items })
}

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

  if (parsed.data.action === 'repetir') {
    if (job.jobType !== 'gerar_prova' || !['concluido', 'erro'].includes(job.status)) {
      return NextResponse.json({ error: 'Só é possível repetir a configuração de uma prova concluída ou com erro.' }, { status: 409 })
    }
    const [created] = await db.insert(generationJobs).values({
      jobType: 'gerar_prova',
      payload: job.payload,
      requestedBy: currentUser.id,
      priority: job.priority,
    }).returning({ id: generationJobs.id })
    return NextResponse.json({ id: created.id, status: 'pendente' }, { status: 201 })
  }

  if (parsed.data.action === 'retomar_pendentes') {
    if (job.jobType !== 'gerar_prova' || job.status !== 'concluido' || !job.resultExamId) {
      return NextResponse.json({ error: 'Só é possível retomar questões pendentes de uma prova salva parcialmente.' }, { status: 409 })
    }
    const ok = await retryPartialJob(jobId)
    if (!ok) return NextResponse.json({ error: 'O job não tem questões pendentes para retomar.' }, { status: 409 })
    return NextResponse.json({ id: jobId, status: 'pendente' })
  }

  const ok = await retryJob(jobId)
  if (!ok) {
    return NextResponse.json({ error: 'Só é possível reenfileirar um job que terminou em erro.' }, { status: 409 })
  }
  return NextResponse.json({ id: jobId, status: 'pendente' })
}
