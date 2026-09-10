import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, and, ne, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams, users, EXAM_STATUSES } from '@/db/schema'
import { auth } from '@/auth/auth'
import { generateExamDocs } from '@/lib/docs/generateExamDocs'
import { sendChatAssignmentNotification, sendChatReviewReadyNotification } from '@/lib/notifications/googleChat'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { enqueuePontuarProvaJob } from '@/lib/queue/enqueue'
import { isSelfManagedActivity } from '@/lib/exams/activityWorkflow'
import { SheetAssignmentsSnapshotError, snapshotSheetAssignments } from '@/lib/scan-sheets/sheetAssignments'

const bodySchema = z.object({
  action: z.enum(['atribuir', 'iniciar_revisao', 'concluir_revisao', 'aprovar', 'marcar_impresso', 'marcar_aplicado', 'marcar_corrigido', 'finalizar_atividade', 'marcar_atividade_aplicada']),
  assignedTo: z.number().int().optional(),
})

type ExamStatus = (typeof EXAM_STATUSES)[number]
type Action = z.infer<typeof bodySchema>['action']

// Only the transitions listed here are valid from a given status — enforced
// server-side regardless of what the UI shows, since role/status can drift
// (another tab, another reviewer) between page load and the click.
// `assigneeAllowed`: true means the person the prova is assigned to can also
// do it, not just coordenação (confirmed 2026-07-14 — iniciar/aplicar/
// corrigir are the assigned reviewer's own workflow steps).
const TRANSITIONS: Record<Action, { from: ExamStatus; to: ExamStatus; assigneeAllowed: boolean; ownerAllowed?: boolean }> = {
  atribuir: { from: 'rascunho', to: 'atribuido', assigneeAllowed: false },
  iniciar_revisao: { from: 'atribuido', to: 'em_andamento', assigneeAllowed: true },
  concluir_revisao: { from: 'em_andamento', to: 'revisao_concluida', assigneeAllowed: true },
  aprovar: { from: 'revisao_concluida', to: 'aprovado', assigneeAllowed: false },
  marcar_impresso: { from: 'aprovado', to: 'impresso', assigneeAllowed: false },
  marcar_aplicado: { from: 'impresso', to: 'aplicado', assigneeAllowed: true },
  // A correção continua compartilhando a mesma infraestrutura das provas,
  // mas o criador da atividade pode encerrá-la mesmo em registros antigos
  // sem `assigned_to`.
  marcar_corrigido: { from: 'aplicado', to: 'corrigido', assigneeAllowed: true, ownerAllowed: true },
  finalizar_atividade: { from: 'rascunho', to: 'aprovado', assigneeAllowed: false, ownerAllowed: true },
  marcar_atividade_aplicada: { from: 'aprovado', to: 'aplicado', assigneeAllowed: false, ownerAllowed: true },
}

const ACTIVITY_ONLY_ACTIONS = new Set<Action>(['finalizar_atividade', 'marcar_atividade_aplicada'])
const FORMAL_REVIEW_ACTIONS = new Set<Action>(['atribuir', 'iniciar_revisao', 'concluir_revisao', 'aprovar', 'marcar_impresso', 'marcar_aplicado'])

export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })
  const { action, assignedTo } = parsed.data

  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
  if (!exam) return NextResponse.json({ error: 'Prova não encontrada' }, { status: 404 })

  const transition = TRANSITIONS[action]
  const isCoordenacao = isStaffSuperuser(currentUser.role)
  const isAssignee = exam.assignedTo === currentUser.id
  const isOwner = exam.createdBy === currentUser.id
  const isActivity = isSelfManagedActivity(exam)
  // A prova formal continua exigindo revisão/aprovação da coordenação, mas
  // seu criador pode definir quem fará a revisão inicial.
  const canAssignOwnFormalExam = action === 'atribuir' && exam.examKind === 'prova' && isOwner

  // O cliente já apresenta ações próprias de atividade, mas a separação
  // precisa ser aplicada também aqui: uma chamada direta não pode recolocar
  // atividades na fila de atribuição/aprovação das provas formais.
  if ((ACTIVITY_ONLY_ACTIONS.has(action) && !isActivity) || (FORMAL_REVIEW_ACTIONS.has(action) && isActivity)) {
    return NextResponse.json({ error: 'Ação incompatível com o fluxo desta avaliação.' }, { status: 422 })
  }

  if (!isCoordenacao && !canAssignOwnFormalExam && !(transition.assigneeAllowed && isAssignee) && !(transition.ownerAllowed && isActivity && isOwner)) {
    return NextResponse.json({ error: 'Você não tem permissão para essa ação nesta prova.' }, { status: 403 })
  }

  if (exam.status !== transition.from) {
    return NextResponse.json({ error: `Transição inválida: prova está em "${exam.status}", esperado "${transition.from}".` }, { status: 409 })
  }

  if (action === 'atribuir') {
    if (!assignedTo) return NextResponse.json({ error: 'assignedTo é obrigatório para atribuir.' }, { status: 400 })
    const reviewer = await db.query.users.findFirst({ where: eq(users.id, assignedTo) })
    if (!reviewer || !reviewer.active) return NextResponse.json({ error: 'Usuário atribuído não encontrado ou inativo.' }, { status: 400 })

    await db
      .update(generatedExams)
      .set({ status: 'atribuido', assignedTo, assignedBy: currentUser.id, assignedAt: new Date() })
      .where(eq(generatedExams.id, examId))

    const examLabel = `${exam.subject} — ${exam.gradeYear}º ano${exam.bimester ? ` — ${exam.bimester}º bimestre` : ''}`
    const reviewUrl = `${process.env.NEXTAUTH_URL ?? ''}/gerar/${examId}/revisar`
    const sent = await sendChatAssignmentNotification(reviewer.email, examLabel, reviewUrl)
    if (sent) await db.update(generatedExams).set({ chatNotifiedAt: new Date() }).where(eq(generatedExams.id, examId))

    return NextResponse.json({ ok: true, chatNotified: sent })
  }

  if (action === 'concluir_revisao') {
    const payload = exam.generationPayload as ExamGenerationResult
    const pendingReview = payload.questions.filter((question) => question.review?.adequacy !== 'adequada').map((question) => question.number)
    if (pendingReview.length) {
      return NextResponse.json({ error: `Revise todas as questões antes de concluir. Pendentes: ${pendingReview.map((number) => `Q${number}`).join(', ')}.` }, { status: 409 })
    }
    await db
      .update(generatedExams)
      .set({ status: 'revisao_concluida', reviewReadyNotifiedAt: new Date() })
      .where(eq(generatedExams.id, examId))

    const recipients = await db.query.users.findMany({
      where: and(inArray(users.role, ['coordenacao', 'direcao']), eq(users.active, true), ne(users.id, currentUser.id)),
      columns: { email: true },
    })
    const examLabel = `${exam.subject} — ${exam.gradeYear}º ano${exam.bimester ? ` — ${exam.bimester}º bimestre` : ''}`
    const reviewUrl = `${process.env.NEXTAUTH_URL ?? ''}/gerar/${examId}/revisar`
    const { sent } = await sendChatReviewReadyNotification(recipients.map((r) => r.email), currentUser.name, examLabel, reviewUrl)

    return NextResponse.json({ ok: true, chatNotified: sent })
  }

  if (action === 'aprovar' || action === 'finalizar_atividade') {
    try {
      const payload = exam.generationPayload as ExamGenerationResult
      const result = await generateExamDocs(payload, {
        segment: exam.segment,
        gradeYear: exam.gradeYear,
        subject: exam.subject,
        bimester: exam.bimester,
        examKind: exam.examKind,
      })

      await db
        .update(generatedExams)
        .set({
          status: 'aprovado',
          reviewedAt: new Date(),
          finalizedAt: new Date(),
          // Atividades antigas podem não ter responsável. Ao finalizá-las,
          // preservamos o criador como responsável pela aplicação/correção,
          // sem nunca depender de uma atribuição da coordenação.
          ...(action === 'finalizar_atividade' && exam.assignedTo == null
            ? { assignedTo: exam.createdBy, assignedBy: currentUser.id, assignedAt: new Date() }
            : {}),
          driveFolderId: result.driveFolderId,
          provaDocId: result.prova.docId,
          provaDocUrl: result.prova.url,
          gabaritoDocId: result.gabarito.docId,
          gabaritoDocUrl: result.gabarito.url,
          mapaDocId: result.mapa.docId,
          mapaDocUrl: result.mapa.url,
        })
        .where(eq(generatedExams.id, examId))

      return NextResponse.json({ ok: true, provaDocUrl: result.prova.url, gabaritoDocUrl: result.gabarito.url, mapaDocUrl: result.mapa.url })
    } catch (err) {
      console.error('[exams/status] erro ao finalizar/gerar documentos:', err)
      const message = err instanceof Error ? err.message : 'Erro ao gerar documentos no Google Docs.'
      return NextResponse.json({ error: message }, { status: 502 })
    }
  }

  const timestampField: Partial<Record<Action, string>> = {
    marcar_impresso: 'printedAt',
    marcar_aplicado: 'appliedAt',
    marcar_atividade_aplicada: 'appliedAt',
    marcar_corrigido: 'correctedAt',
  }
  const field = timestampField[action]

  // A impressão é o último momento confiável antes da aplicação. Quando a
  // prova já tem uma turma vinculada, congelamos o roster aqui para que cada
  // aluno receba o próprio cartão com QR — sem depender de uma etapa manual.
  // A transição só ocorre depois do preparo, evitando marcar uma prova como
  // impressa quando o lote de cartões não pôde ser montado.
  let readySheetAssignmentIds: number[] = []
  if (action === 'marcar_impresso' && exam.examKind === 'prova' && exam.classroomCourseId) {
    try {
      const snapshot = await snapshotSheetAssignments({
        examId,
        exam,
        currentUserId: currentUser.id,
        googleAccessToken: session.googleAccessToken,
        googleRefreshFailed: session.googleError === 'RefreshAccessTokenError',
      })
      readySheetAssignmentIds = snapshot.assignments
        .filter((assignment) => assignment.status === 'pronta')
        .map((assignment) => assignment.id)
    } catch (err) {
      if (err instanceof SheetAssignmentsSnapshotError) {
        return NextResponse.json({ error: err.code, message: err.message }, { status: err.status })
      }
      console.error('[exams/status] falha ao preparar cartões-resposta:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: 'sheet_snapshot_failed', message: 'Não foi possível preparar os cartões-resposta da turma.' }, { status: 502 })
    }
  }

  await db
    .update(generatedExams)
    .set({ status: transition.to, ...(field ? { [field]: new Date() } : {}) })
    .where(eq(generatedExams.id, examId))

  // Pontuação consolidada (Subtarefa 2): fechar a correção da prova
  // reprocessa o score de todas as correções revisadas — idempotente,
  // pega qualquer correção cujo enqueue individual tenha falhado.
  if (action === 'marcar_corrigido') {
    try {
      await enqueuePontuarProvaJob(examId, currentUser.id)
    } catch (err) {
      console.warn('[exams/status] falha ao enfileirar pontuação (segue sem):', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ ok: true, readySheetAssignmentIds })
}
