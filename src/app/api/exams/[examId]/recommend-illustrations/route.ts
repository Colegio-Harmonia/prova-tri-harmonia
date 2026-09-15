import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { recommendIllustrations } from '@/lib/illustrations/recommendations'

const bodySchema = z.object({ questionNumber: z.number().int().positive() })
export async function POST(req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const { examId: rawExamId } = await props.params; const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const parsed = bodySchema.safeParse(await req.json()); const examId = Number(rawExamId)
  if (!parsed.success || !Number.isSafeInteger(examId)) return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 })
  const access = await authorizeExamAccess(examId, session.user.email); if ('error' in access) return access.error
  const question = (access.exam.generationPayload as ExamGenerationResult).questions.find((item) => item.number === parsed.data.questionNumber)
  if (!question) return NextResponse.json({ error: 'Questão não encontrada.' }, { status: 404 })
  try { return NextResponse.json({ recommendations: await recommendIllustrations(access.exam.subject, question) }) }
  catch (error) { console.error('[recommend-illustrations]', error); return NextResponse.json({ error: 'Não foi possível analisar as ilustrações desta questão.' }, { status: 502 }) }
}
