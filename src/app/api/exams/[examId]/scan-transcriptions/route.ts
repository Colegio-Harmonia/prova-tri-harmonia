import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examScanPages, examScanReadings, examSheetAssignments } from '@/db/schema'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import { queueDiscursiveTranscriptions } from '@/lib/scan-ingest/transcriptionQueue'

const bodySchema = z.object({
  correctionId: z.number().int().positive().optional(),
  questionNumbers: z.array(z.number().int().positive()).min(1).max(15).optional(),
})

async function accessForExam(examId: number) {
  const session = await auth()
  if (!session?.user?.email) return { error: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  const access = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in access) return { error: access.error }
  return { access }
}

export async function GET(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const { examId: examParam } = await props.params
  const examId = Number(examParam)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const context = await accessForExam(examId)
  if ('error' in context) return context.error

  const statuses = await db.execute(sql`
    SELECT status, count(*)::int AS count
    FROM generation_jobs
    WHERE job_type = 'transcrever_scan'
      AND payload ->> 'examId' = ${String(examId)}
    GROUP BY status
  `) as unknown as Array<{ status: string; count: number }>
  const counts = Object.fromEntries(statuses.map((row) => [row.status, Number(row.count)])) as Record<string, number>
  const assignments = await db.query.examSheetAssignments.findMany({ where: eq(examSheetAssignments.examId, examId), columns: { id: true } })
  const pageIds = assignments.length
    ? (await db.query.examScanPages.findMany({ where: and(inArray(examScanPages.sheetAssignmentId, assignments.map((assignment) => assignment.id)), eq(examScanPages.pageType, 'discursive')), columns: { id: true } })).map((page) => page.id)
    : []
  const ready = pageIds.length
    ? await db.query.examScanReadings.findMany({ where: and(inArray(examScanReadings.pageId, pageIds), eq(examScanReadings.kind, 'discursive'), isNotNull(examScanReadings.suggestedTranscription)), columns: { id: true } })
    : []
  return NextResponse.json({
    queued: counts.pendente ?? 0,
    processing: counts.gerando ?? 0,
    failed: counts.erro ?? 0,
    ready: ready.length,
  })
}

export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const { examId: examParam } = await props.params
  const examId = Number(examParam)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const context = await accessForExam(examId)
  if ('error' in context) return context.error
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos para a fila de transcrição.' }, { status: 400 })
  if (parsed.data.correctionId) {
    const assignment = await db.query.examSheetAssignments.findFirst({ where: and(eq(examSheetAssignments.examId, examId), eq(examSheetAssignments.examCorrectionId, parsed.data.correctionId)) })
    if (!assignment) return NextResponse.json({ error: 'A correção não possui folha individual desta prova.' }, { status: 409 })
  }
  const result = await queueDiscursiveTranscriptions({
    examId,
    requestedBy: context.access.currentUser.id,
    correctionId: parsed.data.correctionId,
    questionNumbers: parsed.data.questionNumbers,
  })
  return NextResponse.json(result, { status: 202 })
}
