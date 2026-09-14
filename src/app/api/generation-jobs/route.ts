import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { GENERATION_JOB_STATUSES, GENERATION_JOB_TYPES, generationJobs, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { llmAvailable } from '@/lib/gemini/llmClient'
import { enqueueGerarProvaBatch, BatchValidationError } from '@/lib/queue/enqueue'
import type { GerarProvaJobPayload } from '@/lib/queue/types'

const curriculumPlanItemSchema = z.object({
  // rowIndex vem da planilha e pode começar em 0.
  unitRowIndex: z.number().int().min(0),
  questionCount: z.number().int().min(0).max(15),
  priority: z.enum(['alta', 'media', 'baixa']),
  visualAid: z.enum(['auto', 'obrigatorio', 'sem_imagem']),
})

// Fila de geração (Subtarefa 1a): POST enfileira um batch (turma/ano + N
// disciplinas → 1 job por disciplina) e devolve 202 na hora; quem executa
// é o serviço worker (scripts/generation-worker.ts). GET alimenta a aba
// "Histórico e Fila de Provas".

const postSchema = z.object({
  segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']),
  gradeYear: z.number().int(),
  academicYear: z.number().int().min(2020).max(2100).optional(),
  classLabel: z.string().min(1).max(120).optional(),
  subjects: z.array(z.string().min(1)).min(1).max(12),
  config: z.object({
    bimester: z.number().int().min(1).max(4).optional(),
    questionCount: z.number().int().min(0).max(15),
    enemBankQuestionIds: z.array(z.number().int()).max(15).optional(),
    assessmentKind: z.enum(['padrao', 'enem']).optional(),
    contentPlan: z.array(curriculumPlanItemSchema).max(60).optional(),
    assignedTo: z.number().int().positive().optional(),
  }),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  // Fail-fast: sem chave do provedor de texto, todo job falharia no worker —
  // melhor recusar na entrada, com a mesma mensagem da rota síncrona.
  if (!await llmAvailable()) {
    return NextResponse.json({ error: 'A chave do provedor de texto ativo não está configurada no servidor.' }, { status: 503 })
  }

  const parsed = postSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  }

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  const requestedAssignee = parsed.data.config.assignedTo
  const assignedTo = isStaffSuperuser(currentUser.role) ? requestedAssignee : currentUser.id
  if (!assignedTo) return NextResponse.json({ error: 'Selecione o professor responsável antes de enviar as provas para a fila.' }, { status: 422 })
  const assignee = await db.query.users.findFirst({ where: eq(users.id, assignedTo), columns: { id: true, role: true, active: true } })
  if (!assignee?.active || assignee.role !== 'professor') return NextResponse.json({ error: 'O responsável selecionado precisa ser um professor ativo.' }, { status: 422 })

  try {
    const enqueued = await enqueueGerarProvaBatch({ ...parsed.data, config: { ...parsed.data.config, assignedTo } }, currentUser.id)
    return NextResponse.json(enqueued, { status: 202 })
  } catch (err) {
    if (err instanceof BatchValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    console.error('[generation-jobs] erro ao enfileirar batch:', err)
    return NextResponse.json({ error: 'Erro ao enfileirar a geração.' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const batchId = params.get('batchId') ? Number(params.get('batchId')) : undefined
  const status = params.get('status')
  const requestedBy = params.get('requestedBy') ? Number(params.get('requestedBy')) : undefined
  const jobTypes = (params.get('jobTypes') ?? '').split(',').filter((type) => (GENERATION_JOB_TYPES as readonly string[]).includes(type))
  const limit = Math.min(100, Math.max(1, Number(params.get('limit')) || 50))

  const conditions = []
  // Professor só vê os próprios jobs, mesmo forçando `requestedBy` na query
  // string — mesma regra do filtro de provas em /api/exams.
  if (!isStaffSuperuser(currentUser.role)) {
    conditions.push(eq(generationJobs.requestedBy, currentUser.id))
  } else if (requestedBy !== undefined && Number.isFinite(requestedBy)) {
    conditions.push(eq(generationJobs.requestedBy, requestedBy))
  }
  if (batchId !== undefined && Number.isFinite(batchId)) conditions.push(eq(generationJobs.batchId, batchId))
  if (status && (GENERATION_JOB_STATUSES as readonly string[]).includes(status)) {
    conditions.push(eq(generationJobs.status, status as (typeof GENERATION_JOB_STATUSES)[number]))
  }
  if (jobTypes.length) {
    conditions.push(inArray(generationJobs.jobType, jobTypes as (typeof GENERATION_JOB_TYPES)[number][]))
  }

  const rows = await db
    .select({
      id: generationJobs.id,
      batchId: generationJobs.batchId,
      jobType: generationJobs.jobType,
      status: generationJobs.status,
      payload: generationJobs.payload,
      attempts: generationJobs.attempts,
      maxAttempts: generationJobs.maxAttempts,
      resultExamId: generationJobs.resultExamId,
      errorMessage: generationJobs.errorMessage,
      requestedBy: generationJobs.requestedBy,
      requesterName: users.name,
      createdAt: generationJobs.createdAt,
      startedAt: generationJobs.startedAt,
      finishedAt: generationJobs.finishedAt,
      availableAt: generationJobs.availableAt,
    })
    .from(generationJobs)
    .innerJoin(users, eq(users.id, generationJobs.requestedBy))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(generationJobs.createdAt), desc(generationJobs.id))
    .limit(limit)

  return NextResponse.json({
    jobs: rows.map((row) => {
      const payload = row.payload as Partial<GerarProvaJobPayload>
      return {
        id: row.id,
        batchId: row.batchId,
        jobType: row.jobType,
        status: row.status,
        // Resumo do pedido pra listagem — o payload completo fica no banco.
        subject: payload.subject ?? null,
        segment: payload.segment ?? null,
        gradeYear: payload.gradeYear ?? null,
        bimester: payload.bimester ?? null,
        classLabel: payload.classLabel ?? null,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        resultExamId: row.resultExamId,
        errorMessage: row.errorMessage,
        requestedBy: row.requestedBy,
        requesterName: row.requesterName,
        createdAt: row.createdAt,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        availableAt: row.availableAt,
      }
    }),
  })
}
