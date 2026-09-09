import { and, asc, eq, inArray } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examCorrections, examScanAuditEvents, examScanPages, examScanReadings, examScanUploads, examSheetAssignments } from '@/db/schema'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { planSheetPages } from '@/lib/scan-sheets/sheetLayout'
import { queueDiscursiveTranscriptions } from '@/lib/scan-ingest/transcriptionQueue'
import { enqueuePontuarProvaJob } from '@/lib/queue/enqueue'
import type { CorrectionAnswer } from '@/types/correction'

const schema = z.object({ correctionId: z.number().int().positive() })

/** Fallback humano para QR ilegível: associa as páginas do upload à folha
 * já emitida para aquele aluno, sem fingir que o QR foi lido corretamente. */
export async function POST(req: NextRequest, props: { params: Promise<{ examId: string; uploadId: string }> }) {
  const { examId: rawExamId, uploadId: rawUploadId } = await props.params
  const examId = Number(rawExamId); const uploadId = Number(rawUploadId)
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!Number.isFinite(examId) || !Number.isFinite(uploadId)) return NextResponse.json({ error: 'ID inválido.' }, { status: 400 })
  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Aluno inválido.' }, { status: 400 })
  const access = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in access) return access.error
  const [upload, correction, assignment] = await Promise.all([
    db.query.examScanUploads.findFirst({ where: and(eq(examScanUploads.id, uploadId), eq(examScanUploads.examId, examId)) }),
    db.query.examCorrections.findFirst({ where: and(eq(examCorrections.id, parsed.data.correctionId), eq(examCorrections.examId, examId)) }),
    db.query.examSheetAssignments.findFirst({ where: and(eq(examSheetAssignments.examId, examId), eq(examSheetAssignments.examCorrectionId, parsed.data.correctionId)) }),
  ])
  if (!upload || !correction) return NextResponse.json({ error: 'Processamento ou correção não encontrado.' }, { status: 404 })
  if (!assignment) return NextResponse.json({ error: 'Este aluno não possui uma folha emitida; emita as folhas antes de associar manualmente.' }, { status: 409 })
  const plan = planSheetPages((access.exam.generationPayload as ExamGenerationResult).questions)
  const pages = await db.query.examScanPages.findMany({ where: eq(examScanPages.uploadId, uploadId), orderBy: [asc(examScanPages.pageIndex)] })
  if (pages.length !== plan.length) return NextResponse.json({ error: `O envio tem ${pages.length} página(s), mas a folha desta prova precisa de ${plan.length}.` }, { status: 422 })
  const readings = pages.length
    ? await db.query.examScanReadings.findMany({ where: inArray(examScanReadings.pageId, pages.map((page) => page.id)) })
    : []
  await db.transaction(async (tx) => {
    for (const page of pages) {
      const expected = plan[page.pageIndex - 1]
      if (!expected) continue
      await tx.update(examScanPages).set({ sheetAssignmentId: assignment.id, sheetPageNumber: page.pageIndex, pageType: expected.kind, status: 'needs_review', exceptionCode: 'QR_MANUALLY_ASSOCIATED', updatedAt: new Date() }).where(eq(examScanPages.id, page.id))
    }
    // Antes da associação manual, o OCR/OMR já pode ter lido as bolhas, mas
    // não tinha um aluno para receber o resultado. Aproveita essas leituras
    // para reconstruir a pré-correção em vez de exigir outro envio da prova.
    const answers = (correction.answers as CorrectionAnswer[]).map((answer) => {
      if (answer.type !== 'objetiva') return answer
      const reading = readings.find((item) => item.kind === 'objective' && item.questionNumber === answer.questionNumber && item.suggestedLetter)
      if (!reading?.suggestedLetter) return answer
      const transcribedAnswer = reading.suggestedLetter.trim().toUpperCase()
      const isCorrect = transcribedAnswer === (answer.correctLetter ?? '').trim().toUpperCase()
      return { ...answer, transcribedAnswer, isCorrect, finalGrade: isCorrect ? 10 : 0 }
    })
    await tx.update(examCorrections).set({ answers, updatedAt: new Date() }).where(eq(examCorrections.id, correction.id))
    await tx.insert(examScanAuditEvents).values({ examId, uploadId, action: 'scan_manually_associated_to_student', actorId: access.currentUser.id, metadata: { correctionId: correction.id, assignmentId: assignment.id } })
  })
  try { await queueDiscursiveTranscriptions({ examId, requestedBy: access.currentUser.id, correctionId: correction.id }) } catch (error) { console.warn('[scan associate] OCR discursivo não entrou na fila:', error instanceof Error ? error.message : error) }
  try { await enqueuePontuarProvaJob(examId, access.currentUser.id) } catch (error) { console.warn('[scan associate] pontuação não entrou na fila:', error instanceof Error ? error.message : error) }
  return NextResponse.json({ ok: true, correctionId: correction.id })
}
