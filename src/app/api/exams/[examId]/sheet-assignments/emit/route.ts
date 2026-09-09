import { NextRequest, NextResponse } from 'next/server'
import { and, asc, eq, inArray } from 'drizzle-orm'
import JSZip from 'jszip'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examSheetAssignments } from '@/db/schema'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import { planSheetPages } from '@/lib/scan-sheets/sheetLayout'
import { generateSheetPdf } from '@/lib/scan-sheets/sheetPdf'
import { createPageQrPayload, createSheetTokenDigest, issuedSheetTokens, readSheetQrSigningKeys, SheetQrSigningConfigurationError } from '@/lib/scan-sheets/sheetQr'

export const runtime = 'nodejs'

const EMITTABLE_STATUSES = ['aprovado', 'impresso'] as const
const bodySchema = z.object({
  assignmentIds: z.array(z.number().int().positive()).min(1).optional(),
  action: z.enum(['emit', 'download']).optional(),
}).strict()

export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 })
  const action = parsed.data.action ?? 'emit'

  const result = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in result) return result.error
  const { exam, currentUser } = result
  if (!EMITTABLE_STATUSES.includes(exam.status as (typeof EMITTABLE_STATUSES)[number])) {
    return NextResponse.json({ error: 'As folhas só podem ser emitidas para uma prova aprovada ou marcada como impressa.' }, { status: 409 })
  }

  let signingKeys
  try {
    signingKeys = readSheetQrSigningKeys()
  } catch (err) {
    if (err instanceof SheetQrSigningConfigurationError) {
      return NextResponse.json({ error: 'sheet_qr_not_configured', message: err.message }, { status: 503 })
    }
    throw err
  }

  const conditions = [eq(examSheetAssignments.examId, examId), eq(examSheetAssignments.status, action === 'emit' ? 'pronta' : 'emitida')]
  if (parsed.data.assignmentIds) conditions.push(inArray(examSheetAssignments.id, parsed.data.assignmentIds))
  const assignments = await db.query.examSheetAssignments.findMany({
    where: and(...conditions),
    orderBy: [asc(examSheetAssignments.studentNameSnapshot)],
  })
  if (assignments.length === 0) {
    return NextResponse.json({ error: action === 'emit' ? 'Não há folhas prontas para emissão.' : 'Não há cartões emitidos para baixar.' }, { status: 409 })
  }

  const payload = exam.generationPayload as ExamGenerationResult
  let pagePlan
  try {
    pagePlan = planSheetPages(payload.questions)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível montar o layout da folha.'
    return NextResponse.json({ error: 'layout_not_supported', message }, { status: 422 })
  }

  const zip = new JSZip()
  const emissions: Array<{ assignmentId: number; tokenDigest: string }> = []
  // Emite sequencialmente para não manter vários PDFs e QR em memória em um
  // lote de turma; o ZIP já acumula os bytes necessários para o download.
  for (const assignment of assignments) {
    if (assignment.layoutVersion !== 'PTR1' || assignment.pageCount !== pagePlan.length) {
      throw new Error(`A atribuição ${assignment.id} não corresponde ao layout PTR1 atual; gere uma nova atribuição antes de emitir.`)
    }
    const qrTokens = action === 'emit'
      ? pagePlan.map((_, pageIndex) => createPageQrPayload({
        publicId: assignment.publicId,
        pageNumber: pageIndex + 1,
        layoutVersion: assignment.layoutVersion,
      }, signingKeys[0]))
      : issuedSheetTokens({
        publicId: assignment.publicId,
        pageCount: assignment.pageCount,
        layoutVersion: assignment.layoutVersion,
        tokenDigest: assignment.tokenDigest,
        signingKeys,
      })
    if (!qrTokens) {
      return NextResponse.json({
        error: 'issued_sheet_unavailable',
        message: 'Não foi possível recuperar a assinatura original de um dos cartões emitidos. Gere uma reimpressão controlada antes de usá-lo.',
      }, { status: 409 })
    }
    const pdf = await generateSheetPdf({
      studentName: assignment.studentNameSnapshot,
      subject: exam.subject,
      gradeYear: exam.gradeYear,
      academicYear: exam.academicYear,
      bimester: exam.bimester,
      publicId: assignment.publicId,
      layoutVersion: assignment.layoutVersion,
      qrTokens,
      questions: payload.questions,
    })
    zip.file(`folha-${assignment.publicId}.pdf`, pdf)
    if (action === 'emit') emissions.push({ assignmentId: assignment.id, tokenDigest: createSheetTokenDigest(qrTokens) })
  }

  const archive = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  // Next's BodyInit typing requires ArrayBuffer (not the generic Uint8Array
  // returned by JSZip), so copiamos o buffer antes de responder.
  const archiveBody = new Uint8Array(archive).buffer
  if (action === 'emit') {
    const emittedAt = new Date()
    await db.transaction(async (tx) => {
      for (const emission of emissions) {
        await tx
          .update(examSheetAssignments)
          .set({ status: 'emitida', tokenDigest: emission.tokenDigest, emittedAt, emittedBy: currentUser.id, updatedAt: emittedAt })
          .where(and(eq(examSheetAssignments.id, emission.assignmentId), eq(examSheetAssignments.status, 'pronta')))
      }
    })
  }

  return new NextResponse(archiveBody, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="cartoes-resposta-${examId}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
