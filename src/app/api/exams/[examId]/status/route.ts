import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, and, ne, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams, users, EXAM_STATUSES } from '@/db/schema'
import { auth } from '@/auth/auth'
import { generateExamDocs } from '@/lib/docs/generateExamDocs'
import { sendChatAssignmentNotification, sendChatReviewReadyNotification } from '@/lib/notifications/googleChat'
import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { findDiscursiveWithoutReferenceAnswer, referenceAnswerMissingMessage } from '@/lib/exams/referenceAnswer'
import { isSelfManagedActivity } from '@/lib/exams/activityWorkflow'
import { SheetAssignmentsSnapshotError, snapshotSheetAssignments } from '@/lib/scan-sheets/sheetAssignments'
import { enqueuePontuarProvaJob } from '@/lib/queue/enqueue'
import { qualityApprovalBlocks, runQuestionQualityTest } from '@/lib/exams/questionQualityTest'
import { latestQualityReport, normalizeStoredQualityReport, qualityReportNeedsNormalization, qualityReportNeedsRecompute, recomputeQualityReport } from '@/lib/exams/qualityReport'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { planIdFromExamPayload } from '@/lib/curriculum/planCurriculum'
import { generateQuestionWithUnifiedFlow } from '@/lib/exams/unifiedQuestionGeneration'
import { AiBudgetExceededError } from '@/lib/ai/operationBudget'

const bodySchema = z.object({
  action: z.enum(['atribuir', 'iniciar_revisao', 'aprovar_prova', 'concluir_revisao', 'aprovar', 'marcar_impresso', 'marcar_aplicado', 'marcar_corrigido', 'finalizar_atividade', 'marcar_atividade_aplicada']),
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
  iniciar_revisao: { from: 'atribuido', to: 'em_revisao', assigneeAllowed: true },
  aprovar_prova: { from: 'em_revisao', to: 'aprovado', assigneeAllowed: true },
  concluir_revisao: { from: 'em_andamento', to: 'revisao_concluida', assigneeAllowed: true }, // histórico legado
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
const FORMAL_REVIEW_ACTIONS = new Set<Action>(['atribuir', 'iniciar_revisao', 'aprovar_prova', 'concluir_revisao', 'aprovar', 'marcar_impresso', 'marcar_aplicado'])

/**
 * Recupera provas legadas que foram salvas com itens recusados. Esta é uma
 * ponte de migração: a geração nova já faz isso antes de persistir, mas o
 * clique único em Aprovar também não pode obrigar o usuário a trocar itens.
 */
async function replaceRejectedQuestionsAutomatically(exam: typeof generatedExams.$inferSelect, payload: ExamGenerationResult) {
  const rejected = latestQualityReport(payload)?.results.filter((result) => !result.approved).map((result) => result.questionNumber) ?? []
  if (!rejected.length) return payload

  const curriculum = await getCurriculumForExam({
    segment: exam.segment,
    gradeYear: exam.gradeYear,
    subject: exam.subject,
    bimester: exam.bimester ?? undefined,
    curriculumPlanId: planIdFromExamPayload(exam.generationPayload),
  })
  let questions = [...payload.questions]
  for (const questionNumber of rejected) {
    const index = questions.findIndex((question) => question.number === questionNumber)
    const original = questions[index]
    if (!original || original.source === 'enem_bank') throw new Error(`A questão ${questionNumber} não pode ser substituída automaticamente.`)
    let replacement: ExamQuestion | null = null
    // Mesmo pipeline da troca manual ("Trocar só essa questão") e da geração
    // principal. O caminho antigo (prompt avulso + schema de 1 questão) caía no
    // teto padrão de tokens do contexto e voltava sempre `empty_response`: em
    // produção nunca produziu uma substituta (0 sucessos, 83 falhas desde
    // 30/09/2026), deixando a prova impossível de aprovar.
    // Cada candidata passa pela mesma auditoria da questão; se ainda houver
    // problema bloqueante ou a IA errar o contrato, iniciamos outra candidata.
    for (let candidateNumber = 1; candidateNumber <= 3 && !replacement; candidateNumber++) {
      try {
        const generated = await generateQuestionWithUnifiedFlow({
          curriculum,
          questionNumber,
          type: original.type,
          targetSkillCodes: original.bnccStatus === 'mapeado' ? original.bnccCodes : undefined,
          instruction: [
            `substituir a questão ${questionNumber}; tipo ${original.type}`,
            `substituição automática ${candidateNumber}/3: crie uma questão nova com cálculo, alternativas e gabarito verificáveis`,
            `não repita nem reutilize o enunciado anterior: ${original.statement.slice(0, 300)}`,
          ].join('; '),
        })
        const quality = await runQuestionQualityTest(curriculum, [generated.question])
        if (quality.issues.some((issue) => issue.severity === 'bloqueante')) continue
        replacement = generated.question
      } catch (error) {
        // Falha de contrato/validação/IA numa candidata não derruba a
        // aprovação: tenta outra. Só o teto de orçamento de IA interrompe.
        if (error instanceof AiBudgetExceededError) throw error
        console.warn(`[exams/status] substituta automática ${candidateNumber}/3 da questão ${questionNumber} falhou:`, error instanceof Error ? error.message.slice(0, 300) : error)
      }
    }
    if (!replacement) throw new Error(`Não foi possível criar uma substituta aprovada para a questão ${questionNumber}; a prova permanece sem aprovação para preservar a integridade do conteúdo.`)
    // A substituição automática preserva a revisão já concluída da prova;
    // o novo item foi validado pelo mesmo gate antes de entrar no payload.
    questions[index] = { ...replacement, number: questionNumber, review: original.review }
  }
  const repaired = await recomputeQualityReport({
    payload: { ...payload, questions },
    curriculum,
    phase: 'Substituições automáticas durante a aprovação',
    repairedQuestionNumbers: rejected,
  })
  return repaired.payload
}

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

  // Descritiva sem resposta esperada não pode seguir pra revisão concluída/
  // aprovação: a correção ficaria sem base. Vale também pra provas antigas.
  if (action === 'concluir_revisao' || action === 'aprovar' || action === 'finalizar_atividade') {
    const payload = exam.generationPayload as ExamGenerationResult
    const missing = findDiscursiveWithoutReferenceAnswer(payload.questions ?? [])
    if (missing.length) {
      return NextResponse.json({ error: 'missing_reference_answer', message: referenceAnswerMissingMessage(missing), questions: missing }, { status: 422 })
    }
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

  if (action === 'aprovar_prova' || action === 'concluir_revisao') {
    const payload = exam.generationPayload as ExamGenerationResult
    const pendingReview = payload.questions.flatMap((question) => {
      const pending: string[] = []
      if (question.review?.adequacy !== 'adequada') pending.push(`Questão ${question.number}`)
      if (question.image && !question.image.approved) pending.push(`Imagem da questão ${question.number}`)
      return pending
    })
    if (pendingReview.length) {
      return NextResponse.json({ error: `Revise todos os itens antes de concluir. Pendentes: ${pendingReview.join(', ')}.` }, { status: 409 })
    }
    if (action === 'concluir_revisao') await db
      .update(generatedExams)
      .set({ status: 'revisao_concluida', reviewReadyNotifiedAt: new Date() })
      .where(eq(generatedExams.id, examId))

    if (action === 'concluir_revisao') {
    const recipients = await db.query.users.findMany({
      where: and(inArray(users.role, ['coordenacao', 'direcao']), eq(users.active, true), ne(users.id, currentUser.id)),
      columns: { email: true },
    })
    const examLabel = `${exam.subject} — ${exam.gradeYear}º ano${exam.bimester ? ` — ${exam.bimester}º bimestre` : ''}`
    const reviewUrl = `${process.env.NEXTAUTH_URL ?? ''}/gerar/${examId}/revisar`
    const { sent } = await sendChatReviewReadyNotification(recipients.map((r) => r.email), currentUser.name, examLabel, reviewUrl)

    return NextResponse.json({ ok: true, chatNotified: sent })
    }
  }

  if (action === 'aprovar_prova' || action === 'aprovar' || action === 'finalizar_atividade') {
    try {
      let payload = exam.generationPayload as ExamGenerationResult
      let qualityBlocks = qualityApprovalBlocks(payload)

      // Auto-cura: a auditoria já acontece na geração, mas provas antigas,
      // regeneradas ou com relatório inconsistente (ex.: critério "não
      // aplicável" marcado como reprovado por versões anteriores) são
      // reauditadas aqui, sem exigir ação extra do revisor e sem alterar as
      // questões. Persistimos o relatório canônico antes de reavaliar.
      if (qualityReportNeedsRecompute(payload)) {
        try {
          const curriculum = await getCurriculumForExam({
            segment: exam.segment,
            gradeYear: exam.gradeYear,
            subject: exam.subject,
            bimester: exam.bimester ?? undefined,
            curriculumPlanId: planIdFromExamPayload(exam.generationPayload),
          })
          const recomputed = await recomputeQualityReport({
            payload,
            curriculum,
            phase: 'Auditoria automática durante a aprovação',
          })
          payload = recomputed.payload
          await db.update(generatedExams).set({ generationPayload: payload }).where(eq(generatedExams.id, examId))
          qualityBlocks = qualityApprovalBlocks(payload)
        } catch (recomputeError) {
          // A auto-cura é um reforço, não pode virar um novo bloqueio. Se a
          // reauditoria falhar (Sheets/IA indisponíveis), seguimos com o
          // relatório já normalizado em mãos.
          console.error('[exams/status] falha ao recompor auditoria de qualidade:', recomputeError)
        }
      } else if (qualityReportNeedsNormalization(payload)) {
        // Sem IA: limpa critérios "não aplicáveis" mal classificados e
        // recalcula o veredito de relatórios de versões anteriores.
        payload = normalizeStoredQualityReport(payload)
        await db.update(generatedExams).set({ generationPayload: payload }).where(eq(generatedExams.id, examId))
        qualityBlocks = qualityApprovalBlocks(payload)
      }
      // Registros criados antes do gate definitivo podem conter itens que a
      // auditoria já recusou. No mesmo clique de aprovação, substituímos esses
      // itens, refazemos a auditoria integral e só seguimos se tudo aprovar.
      if (qualityBlocks.length && latestQualityReport(payload)?.results.some((result) => !result.approved)) {
        payload = await replaceRejectedQuestionsAutomatically(exam, payload)
        await db.update(generatedExams).set({ generationPayload: payload }).where(eq(generatedExams.id, examId))
        qualityBlocks = qualityApprovalBlocks(payload)
      }
      if (qualityBlocks.length) {
        return NextResponse.json({
          error: `Aprovação bloqueada pelo controle de qualidade. ${qualityBlocks.join(' ')}`,
          qualityBlocks,
        }, { status: 409 })
      }
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
