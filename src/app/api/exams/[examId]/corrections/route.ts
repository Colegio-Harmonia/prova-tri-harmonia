import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { examCorrections } from '@/db/schema'
import { auth } from '@/auth/auth'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { buildEmptyAnswers } from '@/lib/corrections/buildEmptyAnswers'
import { loadExamAndAuthorize, CORRECTABLE_STATUSES } from '@/lib/corrections/authorize'

export async function GET(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const result = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in result) return result.error

  const corrections = await db.query.examCorrections.findMany({
    where: eq(examCorrections.examId, examId),
    orderBy: (t, { asc }) => [asc(t.studentName)],
  })

  return NextResponse.json({ corrections })
}

const createSchema = z.object({
  studentName: z.string().min(1),
  studentEmail: z.string().email().nullable().optional(),
})

export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  if (!Number.isFinite(examId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const parsed = createSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })

  const result = await loadExamAndAuthorize(examId, session.user.email)
  if ('error' in result) return result.error
  const { currentUser, exam } = result

  if (!CORRECTABLE_STATUSES.includes(exam.status)) {
    return NextResponse.json({ error: 'Só é possível corrigir uma prova depois que ela foi aplicada.' }, { status: 409 })
  }

  const payload = exam.generationPayload as ExamGenerationResult
  const answers = buildEmptyAnswers(payload)

  const [created] = await db
    .insert(examCorrections)
    .values({
      examId,
      studentName: parsed.data.studentName,
      studentEmail: parsed.data.studentEmail ?? null,
      answers,
      createdBy: currentUser.id,
    })
    .returning()

  return NextResponse.json({ correction: created })
}
