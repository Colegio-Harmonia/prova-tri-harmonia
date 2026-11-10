import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { importAcervoQuestionById } from '@/lib/exams/acervoQuestions'
import { assembleManualExam, classifyManualQuestion, manualClassificationComplete } from '@/lib/exams/manualExam'
import { presentAcervoExam } from '@/lib/exams/acervoPresentation'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { questionContentKey } from '@/lib/exams/questionOrigin'

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('import'), questionId: z.number().int().positive().safe() }),
  z.object({ action: z.literal('retry'), questionId: z.number().int().positive().safe() }),
  z.object({ action: z.literal('remove'), questionId: z.number().int().positive().safe() }),
  z.object({ action: z.literal('reorder'), questionIds: z.array(z.number().int().positive().safe()).max(30) }),
  z.object({ action: z.literal('finish') }),
])

export async function POST(req: NextRequest, { params }: { params: Promise<{ examId: string }> }) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const examId = Number((await params).examId)
  if (!Number.isSafeInteger(examId) || examId <= 0) return NextResponse.json({ error: 'Prova inválida.' }, { status: 400 })
  const access = await authorizeExamAccess(examId, session.user.email)
  if ('error' in access) return access.error
  const parsed = actionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  const action = parsed.data
  const initial = access.exam.generationPayload as ExamGenerationResult
  if (initial.metadata.creationMode !== 'manual' || access.exam.status !== 'rascunho' || access.exam.archivedAt) return NextResponse.json({ error: 'Esta prova não está em criação manual.' }, { status: 409 })
  const existing = 'questionId' in action ? initial.questions.find((q) => q.acervoRef?.questionId === action.questionId) : undefined
  if (action.action === 'import' && (existing || initial.questions.length >= 30)) return NextResponse.json({ error: existing ? 'Esta questão já foi incluída.' : 'A prova pode ter até 30 questões.' }, { status: 409 })
  if (action.action === 'retry' && !existing) return NextResponse.json({ error: 'Questão não encontrada.' }, { status: 404 })
  try {
    const classified = action.action === 'import' || action.action === 'retry'
      ? await classifyManualQuestion(existing ?? await importAcervoQuestionById(action.questionId, 1), access.exam)
      : undefined
    const result = await db.transaction(async (tx) => {
      // Imports and edits merge with the latest saved draft, never an old client copy.
      const [locked] = await tx.select().from(generatedExams).where(eq(generatedExams.id, examId)).for('update')
      const payload = locked.generationPayload as ExamGenerationResult
      if (locked.status !== 'rascunho' || locked.archivedAt || payload.metadata.creationMode !== 'manual') return { error: 'A prova já saiu da criação manual.' }
      let questions = [...payload.questions]
      if (action.action === 'import') {
        if (questions.length >= 30 || questions.some((q) => q.acervoRef?.questionId === action.questionId)) return { error: 'Questão já incluída ou limite de 30 questões atingido.' }
        if (questions.some((q) => questionContentKey(q) === questionContentKey(classified!))) return { error: 'Esta questão já está na prova, com outro ID de origem.' }
        questions.push(classified!)
      } else if (action.action === 'retry') {
        if (!questions.some((q) => q.acervoRef?.questionId === action.questionId)) return { error: 'A questão foi removida durante a classificação.' }
        questions = questions.map((q) => q.acervoRef?.questionId === action.questionId ? { ...q, bloomLevel: classified!.bloomLevel, bloomAssessment: classified!.bloomAssessment, inepAssessment: classified!.inepAssessment, saeb: classified!.saeb } : q)
      } else if (action.action === 'remove') {
        questions = questions.filter((q) => q.acervoRef?.questionId !== action.questionId)
      } else if (action.action === 'reorder') {
        if (action.questionIds.length !== questions.length || new Set(action.questionIds).size !== questions.length || questions.some((q) => !action.questionIds.includes(q.acervoRef!.questionId))) return { error: 'A lista mudou. Atualize a página antes de ordenar.' }
        questions = action.questionIds.map((id) => questions.find((q) => q.acervoRef?.questionId === id)!)
      } else if (!questions.length || questions.some((q) => !manualClassificationComplete(q))) {
        return { error: 'Inclua ao menos uma questão e conclua as classificações pendentes antes de revisar.' }
      }
      const exam = assembleManualExam(payload.metadata, questions)
      if (action.action === 'import' && classified?.acervoRef) exam.metadata.acervoHistory = [...(payload.metadata.acervoHistory ?? []), { key: `${classified.acervoRef.origin}:${classified.acervoRef.externalId ?? classified.acervoRef.questionId}`, statement: classified.statement, questionId: classified.acervoRef.questionId }]
      await tx.update(generatedExams).set({ generationPayload: exam, questionCount: exam.metadata.questionCount,
        objectiveCount: exam.metadata.objectiveCount, discursiveCount: exam.metadata.discursiveCount,
        ...(action.action === 'finish' ? { status: 'atribuido' as const } : {}),
      }).where(eq(generatedExams.id, examId))
      return { exam }
    })
    if ('error' in result) return NextResponse.json(result, { status: 409 })
    return NextResponse.json({ exam: presentAcervoExam(result.exam) })
  } catch (error) {
    console.error('[exams/manual] falha', { examId, action: action.action, questionId: 'questionId' in action ? action.questionId : undefined, category: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ error: 'Não foi possível concluir esta operação. Sua prova foi preservada; tente novamente.' }, { status: 502 })
  }
}
