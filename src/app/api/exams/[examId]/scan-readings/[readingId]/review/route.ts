import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examCorrections, examScanAuditEvents, examScanPages, examScanReadings, examSheetAssignments } from '@/db/schema'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import type { CorrectionAnswer } from '@/types/correction'

const bodySchema = z.object({
  decision: z.enum(['accepted', 'rejected']),
  confirmedLetter: z.string().max(1).optional(),
  confirmedTranscription: z.string().max(20000).optional(),
})

export async function PATCH(req: NextRequest, props: { params: Promise<{ examId: string; readingId: string }> }) {
  const params = await props.params
  const examId = Number(params.examId); const readingId = Number(params.readingId)
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!Number.isFinite(examId) || !Number.isFinite(readingId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 })
  const access = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in access) return access.error
  const reading = await db.query.examScanReadings.findFirst({ where: eq(examScanReadings.id, readingId) })
  const page = reading ? await db.query.examScanPages.findFirst({ where: eq(examScanPages.id, reading.pageId) }) : null
  const assignment = page?.sheetAssignmentId ? await db.query.examSheetAssignments.findFirst({ where: and(eq(examSheetAssignments.id, page.sheetAssignmentId), eq(examSheetAssignments.examId, examId)) }) : null
  if (!reading || !page || !assignment) return NextResponse.json({ error: 'Leitura sem folha identificada; ela não pode alterar uma correção.' }, { status: 409 })

  const decision = parsed.data.decision
  const confirmedLetter = reading.kind === 'objective' && decision === 'accepted'
    ? (parsed.data.confirmedLetter ?? reading.suggestedLetter ?? '').trim().toUpperCase()
    : null
  const confirmedTranscription = reading.kind === 'discursive' && decision === 'accepted'
    ? (parsed.data.confirmedTranscription ?? reading.suggestedTranscription ?? '').trim()
    : null
  if (decision === 'accepted' && reading.kind === 'objective' && !/^[A-E]$/.test(confirmedLetter ?? '')) return NextResponse.json({ error: 'A resposta objetiva confirmada precisa ser A, B, C, D ou E.' }, { status: 422 })
  if (decision === 'accepted' && reading.kind === 'discursive' && confirmedTranscription === null) return NextResponse.json({ error: 'Informe a transcrição confirmada ou rejeite a sugestão.' }, { status: 422 })

  const correction = await db.query.examCorrections.findFirst({ where: and(eq(examCorrections.id, assignment.examCorrectionId), eq(examCorrections.examId, examId)) })
  if (!correction) return NextResponse.json({ error: 'Correção formal da folha não encontrada.' }, { status: 409 })
  const priorConfirmed = reading.kind === 'objective' ? reading.confirmedLetter : reading.confirmedTranscription

  const [updated] = await db.transaction(async (tx) => {
    let answers = correction.answers as CorrectionAnswer[]
    if (decision === 'accepted') {
      answers = answers.map((answer) => {
        if (answer.questionNumber !== reading.questionNumber || (reading.kind === 'objective' ? answer.type !== 'objetiva' : answer.type !== 'descritiva')) return answer
        if (reading.kind === 'objective') {
          const isCorrect = confirmedLetter === (answer.correctLetter ?? '').trim().toUpperCase()
          return { ...answer, transcribedAnswer: confirmedLetter!, isCorrect, finalGrade: isCorrect ? 10 : 0 }
        }
        return { ...answer, transcribedAnswer: confirmedTranscription!, isCorrect: null }
      })
    } else if (priorConfirmed !== null) {
      // Só desfaz a resposta formal se ela ainda for exatamente a que esta
      // leitura havia confirmado; uma edição manual posterior não é apagada.
      answers = answers.map((answer) => {
        if (answer.questionNumber !== reading.questionNumber || answer.transcribedAnswer !== priorConfirmed) return answer
        return answer.type === 'objetiva' ? { ...answer, transcribedAnswer: '', isCorrect: null, finalGrade: null } : { ...answer, transcribedAnswer: '', isCorrect: null }
      })
    }
    if (decision === 'accepted' || priorConfirmed !== null) await tx.update(examCorrections).set({ answers, updatedAt: new Date() }).where(eq(examCorrections.id, correction.id))
    const [reviewed] = await tx.update(examScanReadings).set({ reviewStatus: decision, confirmedLetter, confirmedTranscription, reviewedBy: access.currentUser.id, reviewedAt: new Date(), updatedAt: new Date() }).where(eq(examScanReadings.id, reading.id)).returning()
    await tx.insert(examScanAuditEvents).values({ examId, uploadId: page.uploadId, action: 'teacher_scan_reading_reviewed', actorId: access.currentUser.id, metadata: { readingId, questionNumber: reading.questionNumber, decision, kind: reading.kind } })
    return [reviewed]
  })
  return NextResponse.json({ reading: updated })
}
