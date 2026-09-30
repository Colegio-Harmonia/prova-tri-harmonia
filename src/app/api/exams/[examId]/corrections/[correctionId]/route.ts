import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams, examCorrections, examScanPages, examScanReadings, examScanUploads, examSheetAssignments, generationJobs, users } from '@/db/schema'
import { auth } from '@/auth/auth'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import type { CorrectionAnswer } from '@/types/correction'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { persistSoloObservedForCorrection } from '@/lib/pedagogical/soloObservedClassificationService'
import { enqueuePontuarProvaJob } from '@/lib/queue/enqueue'
import { updateExamCorrectionStatus } from '@/lib/corrections/updateExamCorrectionStatus'
import { normalizeAiGrade, questionMaxGrade } from '@/lib/corrections/gradeNormalization'
import { planSheetPages } from '@/lib/scan-sheets/sheetLayout'
import { latestRelevantTranscriptionPages, sheetPageNumberForQuestion, summarizeTranscriptions, type TranscriptionJob, type TranscriptionPage } from '@/lib/scan-ingest/transcriptionStatus'
import { missingGradeQuestionNumbers } from '@/lib/corrections/gradeValidation'

const answerSchema = z.object({
  questionNumber: z.number().int(),
  type: z.enum(['objetiva', 'descritiva']),
  transcribedAnswer: z.string(),
  correctLetter: z.string().nullable(),
  isCorrect: z.boolean().nullable(),
  aiSuggestedGrade: z.number().nullable(),
  aiSuggestedRawGrade: z.number().nullable().optional(),
  aiSuggestedGradeScale: z.enum(['question', '0-10']).nullable().optional(),
  aiSuggestedFeedback: z.string().nullable(),
  finalGrade: z.number().min(0).max(100).nullable(),
  finalFeedback: z.string().nullable(),
})

const patchSchema = z.object({
  answers: z.array(answerSchema),
  status: z.enum(['pendente', 'revisado']).optional(),
})

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ examId: string; correctionId: string }> }
) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  const correctionId = Number(params.correctionId)
  if (!Number.isFinite(examId) || !Number.isFinite(correctionId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
  if (!exam) return NextResponse.json({ error: 'Prova não encontrada' }, { status: 404 })

  const isCoordenacao = isStaffSuperuser(currentUser.role)
  if (!isCoordenacao && exam.assignedTo !== currentUser.id) {
    return NextResponse.json({ error: 'Você não tem permissão pra corrigir essa prova.' }, { status: 403 })
  }
  if (!['aplicado', 'parcialmente_corrigida', 'corrigido'].includes(exam.status)) {
    return NextResponse.json({ error: 'A correção fica disponível somente depois que o professor marca a prova como aplicada.' }, { status: 409 })
  }

  const correction = await db.query.examCorrections.findFirst({ where: eq(examCorrections.id, correctionId) })
  if (!correction || correction.examId !== examId) return NextResponse.json({ error: 'Correção não encontrada' }, { status: 404 })
  if (correction.attendanceStatus === 'ausente') {
    return NextResponse.json({ error: 'Este aluno está marcado como ausente. Desfaça a ausência antes de corrigir a prova.' }, { status: 409 })
  }

  if (parsed.data.status === 'revisado' && correction.status !== 'revisado') {
    const missingGrades = missingGradeQuestionNumbers(parsed.data.answers)
    if (missingGrades.length > 0) {
      return NextResponse.json({
        error: `Informe a nota das questões ${missingGrades.join(', ')} antes de aprovar a correção.`,
        code: 'grades_missing',
        missingQuestionNumbers: missingGrades,
      }, { status: 422 })
    }
    const assignment = await db.query.examSheetAssignments.findFirst({ where: and(eq(examSheetAssignments.examId, examId), eq(examSheetAssignments.examCorrectionId, correctionId)) })
    if (assignment) {
      const plan = planSheetPages((exam.generationPayload as ExamGenerationResult).questions)
      const discursivePages = plan.filter((page) => page.kind === 'discursive')
      const pages = await db.select({
        id: examScanPages.id,
        sheetPageNumber: examScanPages.sheetPageNumber,
        status: examScanPages.status,
        exceptionCode: examScanPages.exceptionCode,
        canonicalDriveFileId: examScanPages.canonicalDriveFileId,
        createdAt: examScanPages.createdAt,
      }).from(examScanPages)
        .innerJoin(examScanUploads, eq(examScanPages.uploadId, examScanUploads.id))
        .where(and(
          eq(examScanPages.sheetAssignmentId, assignment.id),
          eq(examScanUploads.examId, examId),
          eq(examScanPages.pageType, 'discursive'),
          // Uma página com QR de outra prova pode estar associada ao mesmo
          // lote/assignment, mas nunca deve virar evidência desta correção.
          sql`${examScanPages.exceptionCode} IS DISTINCT FROM 'SCAN_BELONGS_TO_ANOTHER_EXAM'`,
        ))
        .orderBy(
          sql`CASE WHEN ${examScanPages.status} = 'processed' AND ${examScanPages.exceptionCode} IS NULL THEN 0 ELSE 1 END`,
          desc(examScanPages.createdAt),
        )
      const currentPages = latestRelevantTranscriptionPages(pages, (page) => page.sheetPageNumber === null ? null : String(page.sheetPageNumber))
      const latestPageByNumber = new Map<number, typeof currentPages[number]>()
      for (const page of currentPages) if (page.sheetPageNumber !== null) latestPageByNumber.set(page.sheetPageNumber, page)
      const readings = currentPages.length
        ? await db.query.examScanReadings.findMany({ where: inArray(examScanReadings.pageId, currentPages.map((page) => page.id)) })
        : []
      const activeJobRows = await db.query.generationJobs.findMany({
        where: and(eq(generationJobs.jobType, 'transcrever_scan'), inArray(generationJobs.status, ['pendente', 'gerando'])),
        columns: { payload: true, status: true, availableAt: true },
      })
      const activeJobs: TranscriptionJob[] = activeJobRows.flatMap((row) => {
        const payload = row.payload as { examId?: number; pageId?: number; questionNumbers?: number[] } | null
        if (payload?.examId !== examId || !Number.isInteger(payload.pageId)) return []
        return [{ pageId: payload.pageId!, questionNumbers: Array.isArray(payload.questionNumbers) ? payload.questionNumbers.filter((value): value is number => Number.isInteger(value)) : [], status: row.status as 'pendente' | 'gerando', availableAt: row.availableAt }]
      })
      const pageForQuestion = new Map<number, typeof currentPages[number] | undefined>()
      // O número impresso é a posição no plano completo, incluindo páginas
      // objetivas. Renumerar apenas `discursivePages` desloca a evidência e
      // cria pendências fantasmas (por exemplo, questões da folha 3 sendo
      // procuradas na folha 2).
      for (const page of discursivePages) for (const question of page.questions) {
        const sheetPageNumber = sheetPageNumberForQuestion(plan, question.number)
        pageForQuestion.set(question.number, sheetPageNumber ? latestPageByNumber.get(sheetPageNumber) : undefined)
      }
      const summary = summarizeTranscriptions({
        // A tentativa de aprovação já carrega as edições manuais atuais.
        // Avaliar o snapshot antigo do banco obrigaria o professor a salvar
        // e clicar novamente mesmo depois de preencher a resposta.
        answers: parsed.data.answers as CorrectionAnswer[],
        discursiveQuestionNumbers: new Set(discursivePages.flatMap((page) => page.questions.map((question) => question.number))),
        pages: currentPages as TranscriptionPage[],
        readings,
        pageForQuestion,
        activeJobs,
      })
      if (summary.active > 0) {
        return NextResponse.json({ error: `A correção ainda possui ${summary.active} resposta(s) discursiva(s) em transcrição. Aguarde a conclusão antes de aprovar.`, code: 'ocr_in_progress', transcription: summary }, { status: 409 })
      }
      if (summary.needsReview > 0) {
        return NextResponse.json({ error: `A correção possui ${summary.needsReview} resposta(s) discursiva(s) sem leitura concluída. Preencha manualmente ou revise o scan antes de aprovar.`, code: 'ocr_needs_review', transcription: summary }, { status: 409 })
      }
    }
  }

  // Nunca confia no `isCorrect`/nota final de objetiva vindo do cliente —
  // recalcula a partir da letra transcrita, mesmo princípio de não confiar
  // no que o front manda sem checar (ver examValidator.ts pro mesmo padrão
  // aplicado à geração de prova).
  const questionsByNumber = new Map((exam.generationPayload as ExamGenerationResult).questions.map((question) => [question.number, question]))
  for (const answer of parsed.data.answers) {
    const question = questionsByNumber.get(answer.questionNumber)
    if (!question) return NextResponse.json({ error: `Questão ${answer.questionNumber} não pertence a esta prova.` }, { status: 400 })
  }
  const answers: CorrectionAnswer[] = parsed.data.answers.map((a) => {
    const question = questionsByNumber.get(a.questionNumber)!
    const maxGrade = questionMaxGrade(question)
    if (a.type === 'descritiva') {
      const raw = a.aiSuggestedRawGrade ?? a.aiSuggestedGrade
      const suggestion = raw === null ? null : normalizeAiGrade(raw, maxGrade)
      return {
        ...a,
        weight: maxGrade,
        aiSuggestedRawGrade: suggestion?.rawGrade ?? null,
        aiSuggestedGradeScale: suggestion?.sourceScale ?? null,
        aiSuggestedGrade: suggestion?.grade ?? null,
        // Independent server-side invariant for manually entered and
        // automatic grades: storage never exceeds the question maximum.
        finalGrade: a.finalGrade === null ? null : Math.min(maxGrade, Math.max(0, a.finalGrade)),
      }
    }
    const isCorrect = a.transcribedAnswer ? a.transcribedAnswer.trim().toUpperCase() === (a.correctLetter ?? '').toUpperCase() : null
    return { ...a, weight: maxGrade, isCorrect, finalGrade: isCorrect === null ? null : isCorrect ? maxGrade : 0 }
  })

  const updateResult = await db.transaction(async (tx) => {
    // O worker usa o mesmo lock antes de copiar a transcrição para o JSON da
    // correção. A rechecagem dentro da transação fecha a janela entre a
    // consulta de status e o clique de aprovação.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${correctionId})`)
    if (parsed.data.status === 'revisado' && correction.status !== 'revisado') {
      const rows = await tx.execute(sql`
        SELECT count(*)::int AS active_count
        FROM exam_scan_readings reading
        INNER JOIN exam_scan_pages page ON page.id = reading.page_id
        INNER JOIN exam_sheet_assignments assignment ON assignment.id = page.sheet_assignment_id
        WHERE assignment.exam_id = ${examId}
          AND assignment.exam_correction_id = ${correctionId}
          AND reading.kind = 'discursive'
          AND COALESCE(reading.review_status, 'pending') NOT IN ('accepted', 'rejected')
        AND EXISTS (
          SELECT 1
          FROM generation_jobs transcription_job
          WHERE transcription_job.job_type = 'transcrever_scan'
            AND transcription_job.status IN ('pendente', 'gerando')
            AND transcription_job.payload ->> 'examId' = ${String(examId)}
            AND transcription_job.payload ->> 'pageId' = page.id::text
            AND (jsonb_array_length(COALESCE(transcription_job.payload -> 'questionNumbers', '[]'::jsonb)) = 0
              OR transcription_job.payload -> 'questionNumbers' @> to_jsonb(reading.question_number))
        )
          AND page.id IN (
            SELECT DISTINCT ON (latest_page.sheet_page_number) latest_page.id
            FROM exam_scan_pages latest_page
            INNER JOIN exam_scan_uploads latest_upload ON latest_upload.id = latest_page.upload_id
            WHERE latest_page.sheet_assignment_id = assignment.id
              AND latest_upload.exam_id = ${examId}
              AND latest_page.page_type = 'discursive'
              AND latest_page.exception_code IS DISTINCT FROM 'SCAN_BELONGS_TO_ANOTHER_EXAM'
            ORDER BY latest_page.sheet_page_number,
              CASE WHEN latest_page.status = 'processed' AND latest_page.exception_code IS NULL THEN 0 ELSE 1 END,
              latest_page.created_at DESC
          )
      `) as unknown as Array<{ active_count: number }>
      if (Number(rows[0]?.active_count ?? 0) > 0) return { blocked: true as const, updated: null }
    }
    const [updated] = await tx
      .update(examCorrections)
      .set({
        answers,
        status: parsed.data.status ?? correction.status,
        ...(parsed.data.status === 'pendente' ? { scoreResult: null, gradeReturnedAt: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(examCorrections.id, correctionId))
      .returning()
    return { blocked: false as const, updated }
  })
  if (updateResult.blocked) return NextResponse.json({ error: 'A transcrição discursiva começou enquanto esta correção era salva. Aguarde a conclusão antes de aprovar.', code: 'ocr_in_progress' }, { status: 409 })
  const updated = updateResult.updated

  const warnings: string[] = []
  let soloObservedClassificationsCreated = 0
  const shouldClassifySoloObserved = parsed.data.status === 'revisado' && correction.status !== 'revisado'

  // Pontuação consolidada (Subtarefa 2): correção que acabou de fechar
  // enfileira o job idempotente de pontuação da prova. Best-effort — a
  // correção já está salva, e o gatilho de 'marcar_corrigido' na prova
  // cobre qualquer job que falhe em entrar aqui.
  if (shouldClassifySoloObserved) {
    try {
      await enqueuePontuarProvaJob(examId, currentUser.id)
    } catch (err) {
      console.warn('[corrections] falha ao enfileirar pontuação (segue sem):', err instanceof Error ? err.message : err)
    }
  }
  await updateExamCorrectionStatus(examId)

  if (shouldClassifySoloObserved) {
    try {
      const soloObserved = await persistSoloObservedForCorrection({
        examId,
        correctionId,
        answers,
        payload: exam.generationPayload as ExamGenerationResult,
        createdBy: currentUser.id,
        modelProvider: 'deepseek',
        modelName: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
        promptVersion: 'solo-observed-v1',
      })
      soloObservedClassificationsCreated = soloObserved.created.length
      warnings.push(...soloObserved.warnings)
    } catch (err) {
      console.error('[corrections] erro ao persistir SOLO_OBSERVED:', err)
      warnings.push('Correção salva, mas houve erro ao classificar SOLO_OBSERVED das respostas discursivas.')
    }
  }

  return NextResponse.json({ correction: updated, warnings, soloObservedClassificationsCreated })
}

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ examId: string; correctionId: string }> }
) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  const correctionId = Number(params.correctionId)
  if (!Number.isFinite(examId) || !Number.isFinite(correctionId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
  if (!exam) return NextResponse.json({ error: 'Prova não encontrada' }, { status: 404 })

  const isCoordenacao = isStaffSuperuser(currentUser.role)
  if (!isCoordenacao && exam.assignedTo !== currentUser.id) {
    return NextResponse.json({ error: 'Você não tem permissão pra corrigir essa prova.' }, { status: 403 })
  }

  await db.delete(examCorrections).where(eq(examCorrections.id, correctionId))
  return NextResponse.json({ ok: true })
}
