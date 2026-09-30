import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { loadExamAndAuthorize } from '@/lib/corrections/authorize'
import { purgeExamScanData } from '@/lib/scan-ingest/purgeExamScanData'

export const runtime = 'nodejs'

const confirmationSchema = z.object({ confirmation: z.literal('CONFIRMO') })

export async function DELETE(req: NextRequest, props: { params: Promise<{ examId: string }> }): Promise<NextResponse> {
  const { examId: rawExamId } = await props.params
  const examId = Number(rawExamId)
  if (!Number.isInteger(examId) || examId < 1) return NextResponse.json({ error: 'ID inválido.' }, { status: 400 })

  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const access = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in access) return access.error!

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Digite CONFIRMO para confirmar a limpeza.' }, { status: 400 })
  }
  const parsed = confirmationSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Digite CONFIRMO exatamente para confirmar a limpeza.' }, { status: 400 })

  try {
    const result = await purgeExamScanData(examId)
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    console.error(`Falha ao limpar scans da prova ${examId}:`, error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível limpar os scans.' }, { status: 500 })
  }
}
