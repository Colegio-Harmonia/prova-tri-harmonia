import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { desc, eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { adaptedExams, ADAPTATION_PROFILES } from '@/db/schema'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { llmAvailable } from '@/lib/gemini/llmClient'
import { mergeAdaptationLibraries } from '@/lib/adaptation/mergeLibraries'
import { enqueueAdaptarProvaJob } from '@/lib/queue/enqueue'

// Adaptação Inclusiva (Módulo 4): cria a linha de adapted_exams (status
// 'gerando') e enfileira o job 'adaptar_prova'. Pré-condição: prova
// aprovada — adaptar rascunho geraria versão derivada de conteúdo
// instável (spec 4.3). Toda rota de prova passa por authorizeExamAccess.

const ADAPTABLE_STATUSES = ['aprovado', 'impresso', 'aplicado', 'corrigido']

const postSchema = z.object({
  profiles: z.array(z.enum(ADAPTATION_PROFILES)).min(1).max(ADAPTATION_PROFILES.length),
  // LGPD: opcional, fica só no sistema (RBAC) — nunca vai pro documento.
  targetStudentLabel: z.string().min(1).max(120).optional(),
})

export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const routeParams = await props.params
  const examId = Number(routeParams.examId)
  if (!Number.isInteger(examId) || examId <= 0) return NextResponse.json({ error: 'Prova inválida' }, { status: 400 })

  if (!await llmAvailable()) {
    return NextResponse.json({ error: 'A chave do provedor de texto ativo não está configurada no servidor.' }, { status: 503 })
  }

  const parsed = postSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  }

  const authz = await authorizeExamAccess(examId, session.user.email)
  if ('error' in authz) return authz.error
  const { currentUser, exam } = authz

  if (!ADAPTABLE_STATUSES.includes(exam.status)) {
    return NextResponse.json({ error: 'Só é possível adaptar uma prova que já foi revisada e aprovada.' }, { status: 409 })
  }

  const merged = mergeAdaptationLibraries(parsed.data.profiles)

  try {
    const [adaptation] = await db
      .insert(adaptedExams)
      .values({
        examId,
        adaptationProfiles: merged.profiles,
        libraryVersions: merged.libraryVersions,
        targetStudentLabel: parsed.data.targetStudentLabel ?? null,
        status: 'gerando',
        createdBy: currentUser.id,
      })
      .returning({ id: adaptedExams.id })

    const jobId = await enqueueAdaptarProvaJob(adaptation.id, currentUser.id)
    return NextResponse.json({ adaptationId: adaptation.id, jobId }, { status: 202 })
  } catch (err) {
    console.error('[adaptations] erro ao criar adaptação:', err)
    return NextResponse.json({ error: 'Erro ao enfileirar a adaptação.' }, { status: 500 })
  }
}

export async function GET(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const routeParams = await props.params
  const examId = Number(routeParams.examId)
  if (!Number.isInteger(examId) || examId <= 0) return NextResponse.json({ error: 'Prova inválida' }, { status: 400 })

  const authz = await authorizeExamAccess(examId, session.user.email)
  if ('error' in authz) return authz.error

  const adaptations = await db.query.adaptedExams.findMany({
    where: eq(adaptedExams.examId, examId),
    orderBy: [desc(adaptedExams.createdAt)],
  })

  return NextResponse.json({ adaptations })
}
