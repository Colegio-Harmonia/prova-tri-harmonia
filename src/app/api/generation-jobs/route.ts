import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { GENERATION_JOB_STATUSES, GENERATION_JOB_TYPES, generationJobItems, generationJobs, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { llmAvailable } from '@/lib/gemini/llmClient'
import { enqueueGerarProvaBatch, BatchValidationError } from '@/lib/queue/enqueue'
import type { GerarProvaJobPayload } from '@/lib/queue/types'

const curriculumPlanItemSchema = z.object({
  // rowIndex vem da planilha e pode começar em 0.
  unitRowIndex: z.number().int().min(0),
  questionCount: z.number().int().min(0).max(30),
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
    questionCount: z.number().int().min(0).max(30),
    questionSource: z.enum(['acervo', 'ia']).optional(),
    objectivePercentage: z.number().int().min(0).max(100).optional().default(70),
    enemBankQuestionIds: z.array(z.number().int()).max(30).optional(),
    assessmentKind: z.enum(['padrao', 'enem']).optional(),
    contentPlan: z.array(curriculumPlanItemSchema).max(60).optional(),
    curriculumPlanIds: z.record(z.string(), z.number().int().positive()).optional(),
    curriculumPlanVersionIds: z.record(z.string(), z.number().int().positive()).optional(),
    contentPlanIncludesEnem: z.boolean().optional(),
    assignedTo: z.number().int().positive().optional(),
  }),
}).superRefine((input, ctx) => {
  if (input.config.questionCount <= 0) return
  const missing = input.subjects.filter((subject) => !input.config.curriculumPlanIds?.[subject])
  if (missing.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['config', 'curriculumPlanIds'], message: `Selecione um planejamento aprovado na aba Planejamentos para: ${missing.join(', ')}.` })
})

function isMissingCurrentStageColumn(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown }
    if (candidate.code === '42703' && typeof candidate.message === 'string' && candidate.message.includes('current_stage')) return true
    current = candidate.cause
  }
  return false
}

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

  let itemRows: Array<{ jobId: number; slotNumber: number; status: string; currentStage: string | null; lastError: string | null; issues: unknown; hasQuestionPayload: boolean; requiresVisual: boolean | null }> = []
  if (rows.length) {
    try {
      itemRows = await db.select({ jobId: generationJobItems.jobId, slotNumber: generationJobItems.slotNumber, status: generationJobItems.status, currentStage: generationJobItems.currentStage, lastError: generationJobItems.lastError, issues: generationJobItems.issues, hasQuestionPayload: sql<boolean>`${generationJobItems.questionPayload} IS NOT NULL`, requiresVisual: sql<boolean | null>`NULLIF(${generationJobItems.questionPayload}->>'needsImage', '')::boolean` })
        .from(generationJobItems)
        .where(inArray(generationJobItems.jobId, rows.map((row) => row.id)))
    } catch (error) {
      // Instalações antigas sem current_stage ainda exibem a causa salva.
      if (!isMissingCurrentStageColumn(error)) throw error
      const legacyRows = await db.select({ jobId: generationJobItems.jobId, slotNumber: generationJobItems.slotNumber, status: generationJobItems.status, lastError: generationJobItems.lastError, issues: generationJobItems.issues, hasQuestionPayload: sql<boolean>`${generationJobItems.questionPayload} IS NOT NULL`, requiresVisual: sql<boolean | null>`NULLIF(${generationJobItems.questionPayload}->>'needsImage', '')::boolean` })
        .from(generationJobItems)
        .where(inArray(generationJobItems.jobId, rows.map((row) => row.id)))
      itemRows = legacyRows.map((item) => ({ ...item, currentStage: null }))
    }
  }
  const itemsByJob = new Map<number, typeof itemRows>()
  for (const item of itemRows) itemsByJob.set(item.jobId, [...(itemsByJob.get(item.jobId) ?? []), item])

  return NextResponse.json({
    serverTime: new Date().toISOString(),
    jobs: rows.map((row) => {
      const payload = row.payload as Partial<GerarProvaJobPayload> & { examId?: number; questionNumber?: number; bnccCode?: string }
      return {
        id: row.id,
        batchId: row.batchId,
        jobType: row.jobType,
        status: row.status,
        // Resumo do pedido pra listagem — o payload completo fica no banco.
        subject: payload.subject ?? null,
        generationEngine: payload.generationEngine ?? null,
        segment: payload.segment ?? null,
        gradeYear: payload.gradeYear ?? null,
        bimester: payload.bimester ?? null,
        classLabel: payload.classLabel ?? null,
        examId: payload.examId ?? null,
        questionNumber: payload.questionNumber ?? null,
        bnccCode: payload.bnccCode ?? null,
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
        items: (itemsByJob.get(row.id) ?? []).map((item) => {
          const issues = Array.isArray(item.issues) ? item.issues as Array<Record<string, unknown>> : []
          return {
            slotNumber: item.slotNumber,
            status: item.status,
            currentStage: item.currentStage,
            hasQuestionPayload: item.hasQuestionPayload,
            requiresVisual: item.requiresVisual,
            lastError: item.status === 'erro' ? item.lastError?.slice(0, 1200) ?? null : null,
            diagnostics: item.status === 'erro' ? issues.filter((issue) => issue.code !== 'JEV_QUALITY_REPORT').slice(0, 3).map((issue) => ({
              code: typeof issue.code === 'string' ? issue.code : null,
              message: typeof issue.message === 'string' ? issue.message.slice(0, 500) : null,
              resolutionCheck: typeof issue.resolutionCheck === 'string' ? issue.resolutionCheck.slice(0, 500) : null,
            })) : [],
          }
        }),
      }
    }),
  })
}
