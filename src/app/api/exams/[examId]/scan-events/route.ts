import { desc, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { examScanPages, examScanReadings, examScanUploads } from '@/db/schema'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * O banco é a fonte de verdade da fila. Este stream só entrega um sinal leve
 * quando uploads/páginas mudam; a tela então busca o snapshot autorizado da
 * fila. Assim não expomos arquivos, QR ou transcrições via eventos.
 */
export async function GET(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const { examId: rawExamId } = await props.params
  const examId = Number(rawExamId)
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
  const access = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in access) return access.error

  const encoder = new TextEncoder()
  let lastVersion = ''
  let timer: ReturnType<typeof setInterval> | null = null
  const stream = new ReadableStream({
    async start(controller) {
      const publish = async () => {
        const [latestUpload] = await db.query.examScanUploads.findMany({
          where: eq(examScanUploads.examId, examId),
          orderBy: [desc(examScanUploads.updatedAt), desc(examScanUploads.createdAt)],
          limit: 1,
          columns: { id: true, status: true, updatedAt: true, createdAt: true },
        })
        const [latestPage] = await db
          .select({ id: examScanPages.id, status: examScanPages.status, updatedAt: examScanPages.updatedAt })
          .from(examScanPages)
          .innerJoin(examScanUploads, eq(examScanPages.uploadId, examScanUploads.id))
          .where(eq(examScanUploads.examId, examId))
          .orderBy(desc(examScanPages.updatedAt), desc(examScanPages.createdAt))
          .limit(1)
        const [latestReading] = await db
          .select({ id: examScanReadings.id, updatedAt: examScanReadings.updatedAt, exceptionCode: examScanReadings.exceptionCode })
          .from(examScanReadings)
          .innerJoin(examScanPages, eq(examScanReadings.pageId, examScanPages.id))
          .innerJoin(examScanUploads, eq(examScanPages.uploadId, examScanUploads.id))
          .where(eq(examScanUploads.examId, examId))
          .orderBy(desc(examScanReadings.updatedAt), desc(examScanReadings.createdAt))
          .limit(1)
        const version = JSON.stringify([latestUpload?.id, latestUpload?.status, latestUpload?.updatedAt?.toISOString(), latestPage?.id, latestPage?.status, latestPage?.updatedAt?.toISOString(), latestReading?.id, latestReading?.exceptionCode, latestReading?.updatedAt?.toISOString()])
        if (version !== lastVersion) {
          lastVersion = version
          controller.enqueue(encoder.encode(`event: scan-update\ndata: ${version}\n\n`))
        } else controller.enqueue(encoder.encode(': keepalive\n\n'))
      }
      await publish()
      timer = setInterval(() => { void publish().catch(() => {}) }, 1000)
    },
    cancel() { if (timer) clearInterval(timer) },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } })
}
