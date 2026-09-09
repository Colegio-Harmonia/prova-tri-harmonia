import { and, eq, inArray, ne } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examCorrections, examScanAuditEvents, examScanPages, examScanReadings, examScanUploads, examSheetAssignments } from '@/db/schema'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import { buildEmptyAnswers } from '@/lib/corrections/buildEmptyAnswers'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { enqueuePontuarProvaJob } from '@/lib/queue/enqueue'
import { queueDiscursiveTranscriptions } from '@/lib/scan-ingest/transcriptionQueue'
import type { CorrectionAnswer } from '@/types/correction'

/** Torna um reenvio deliberadamente a única leitura oficial daquela folha.
 * A leitura anterior é preservada apenas para auditoria, mas deixa de ser
 * vinculada à folha e nunca mais participa da correção/perfil do aluno. */
export async function POST(_req: NextRequest, props: { params: Promise<{ examId: string; uploadId: string }> }) {
  const { examId: rawExamId, uploadId: rawUploadId } = await props.params
  const examId = Number(rawExamId); const uploadId = Number(rawUploadId)
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!Number.isFinite(examId) || !Number.isFinite(uploadId)) return NextResponse.json({ error: 'ID inválido.' }, { status: 400 })
  const access = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in access) return access.error

  let requestedAssignmentId: number | null = null
  try {
    const parsed = z.object({ assignmentId: z.number().int().positive().optional() }).safeParse(await _req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Dados de substituição inválidos.' }, { status: 400 })
    requestedAssignmentId = parsed.data.assignmentId ?? null
  } catch {
    // Compatibilidade com a ação anterior, que não enviava corpo.
  }

  const upload = await db.query.examScanUploads.findFirst({ where: and(eq(examScanUploads.id, uploadId), eq(examScanUploads.examId, examId)) })
  const newPages = await db.query.examScanPages.findMany({ where: eq(examScanPages.uploadId, uploadId) })
  const duplicateAssignmentIds = new Set(newPages.filter((page) => page.exceptionCode === 'DUPLICATE_SHEET_SCAN' && page.sheetAssignmentId).map((page) => page.sheetAssignmentId!))
  const assignmentId = requestedAssignmentId ?? [...duplicateAssignmentIds][0]
  if (requestedAssignmentId && !duplicateAssignmentIds.has(requestedAssignmentId)) return NextResponse.json({ error: 'Esta folha não está aguardando substituição neste envio.' }, { status: 409 })
  if (!upload || !assignmentId) return NextResponse.json({ error: 'Este envio não está aguardando substituição de uma leitura duplicada.' }, { status: 409 })

  const assignment = await db.query.examSheetAssignments.findFirst({ where: and(eq(examSheetAssignments.id, assignmentId), eq(examSheetAssignments.examId, examId)) })
  if (!assignment) return NextResponse.json({ error: 'Folha da aluna não encontrada.' }, { status: 404 })
  const readings = await db.query.examScanReadings.findMany({ where: inArray(examScanReadings.pageId, newPages.filter((page) => page.sheetAssignmentId === assignment.id).map((page) => page.id)) })

  await db.transaction(async (tx) => {
    // A auditoria continua disponível, mas o scan anterior deixa de ser uma
    // fonte válida para a correção. Isso evita duas fontes oficiais da folha.
    await tx.update(examScanPages).set({
      sheetAssignmentId: null,
      status: 'needs_review',
      exceptionCode: 'SUPERSEDED_BY_NEW_SCAN',
      updatedAt: new Date(),
    }).where(and(eq(examScanPages.sheetAssignmentId, assignment.id), ne(examScanPages.uploadId, uploadId)))

    await tx.update(examScanPages).set({
      status: 'needs_review',
      exceptionCode: null,
      updatedAt: new Date(),
    }).where(and(eq(examScanPages.uploadId, uploadId), eq(examScanPages.sheetAssignmentId, assignment.id)))

    const emptyAnswers = buildEmptyAnswers(access.exam.generationPayload as ExamGenerationResult)
    const answers = emptyAnswers.map((answer) => {
      if (answer.type !== 'objetiva') return answer
      const reading = readings.find((item) => item.kind === 'objective' && item.questionNumber === answer.questionNumber && item.suggestedLetter)
      if (!reading?.suggestedLetter) return answer
      const transcribedAnswer = reading.suggestedLetter.trim().toUpperCase()
      const isCorrect = transcribedAnswer === (answer.correctLetter ?? '').trim().toUpperCase()
      return { ...answer, transcribedAnswer, isCorrect, finalGrade: isCorrect ? 10 : 0 }
    }) as CorrectionAnswer[]
    await tx.update(examCorrections).set({ answers, scoreResult: null, status: 'pendente', gradeReturnedAt: null, updatedAt: new Date() }).where(eq(examCorrections.id, assignment.examCorrectionId))
    await tx.insert(examScanAuditEvents).values({ examId, uploadId, action: 'duplicate_scan_replaced', actorId: access.currentUser.id, metadata: { assignmentId: assignment.id, correctionId: assignment.examCorrectionId } })
  })

  try { await queueDiscursiveTranscriptions({ examId, requestedBy: access.currentUser.id, correctionId: assignment.examCorrectionId }) } catch (error) { console.warn('[replace duplicate] OCR não entrou na fila:', error) }
  try { await enqueuePontuarProvaJob(examId, access.currentUser.id) } catch (error) { console.warn('[replace duplicate] pontuação não entrou na fila:', error) }
  return NextResponse.json({ ok: true, correctionId: assignment.examCorrectionId })
}
