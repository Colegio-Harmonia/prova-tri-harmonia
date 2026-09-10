import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams, examCorrections, users } from '@/db/schema'
import { auth } from '@/auth/auth'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import type { CorrectionAnswer } from '@/types/correction'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { persistSoloObservedForCorrection } from '@/lib/pedagogical/soloObservedClassificationService'
import { enqueuePontuarProvaJob } from '@/lib/queue/enqueue'
import { updateExamCorrectionStatus } from '@/lib/corrections/updateExamCorrectionStatus'

const answerSchema = z.object({
  questionNumber: z.number().int(),
  type: z.enum(['objetiva', 'descritiva']),
  transcribedAnswer: z.string(),
  correctLetter: z.string().nullable(),
  isCorrect: z.boolean().nullable(),
  aiSuggestedGrade: z.number().nullable(),
  aiSuggestedFeedback: z.string().nullable(),
  finalGrade: z.number().min(0).max(10).nullable(),
  finalFeedback: z.string().nullable(),
})

const patchSchema = z.object({
  answers: z.array(answerSchema),
  status: z.enum(['pendente', 'revisado']).optional(),
})

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ examId: string; correctionId: string }> }
) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  const correctionId = Number(params.correctionId)
  if (!Number.isFinite(examId) || !Number.isFinite(correctionId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
  if (!exam) return NextResponse.json({ error: 'Prova não encontrada' }, { status: 404 })

  const isCoordenacao = isStaffSuperuser(currentUser.role)
  if (!isCoordenacao && exam.assignedTo !== currentUser.id) {
    return NextResponse.json({ error: 'Você não tem permissão pra corrigir essa prova.' }, { status: 403 })
  }
  if (!['aplicado', 'parcialmente_corrigida', 'corrigido'].includes(exam.status)) {
    return NextResponse.json({ error: 'A correção fica disponível somente depois que o professor marca a prova como aplicada.' }, { status: 409 })
  }

  const correction = await db.query.examCorrections.findFirst({ where: eq(examCorrections.id, correctionId) })
  if (!correction || correction.examId !== examId) return NextResponse.json({ error: 'Correção não encontrada' }, { status: 404 })

  // Nunca confia no `isCorrect`/nota final de objetiva vindo do cliente —
  // recalcula a partir da letra transcrita, mesmo princípio de não confiar
  // no que o front manda sem checar (ver examValidator.ts pro mesmo padrão
  // aplicado à geração de prova).
  const questionsByNumber = new Map((exam.generationPayload as ExamGenerationResult).questions.map((question) => [question.number, question]))
  for (const answer of parsed.data.answers) {
    const question = questionsByNumber.get(answer.questionNumber)
    if (!question) return NextResponse.json({ error: `Questão ${answer.questionNumber} não pertence a esta prova.` }, { status: 400 })
    const maxGrade = question.weight ?? 1
    if (answer.type === 'descritiva' && answer.finalGrade !== null && answer.finalGrade > maxGrade) {
      return NextResponse.json({ error: `A nota da questão ${answer.questionNumber} não pode ultrapassar ${maxGrade}.` }, { status: 400 })
    }
  }
  const answers: CorrectionAnswer[] = parsed.data.answers.map((a) => {
    const question = questionsByNumber.get(a.questionNumber)!
    const maxGrade = question.weight ?? 1
    if (a.type !== 'objetiva') return a
    const isCorrect = a.transcribedAnswer ? a.transcribedAnswer.trim().toUpperCase() === (a.correctLetter ?? '').toUpperCase() : null
    return { ...a, isCorrect, finalGrade: isCorrect === null ? null : isCorrect ? maxGrade : 0 }
  })

  const [updated] = await db
    .update(examCorrections)
    .set({ answers, status: parsed.data.status ?? correction.status, updatedAt: new Date() })
    .where(eq(examCorrections.id, correctionId))
    .returning()

  const warnings: string[] = []
  let soloObservedClassificationsCreated = 0
  const shouldClassifySoloObserved = parsed.data.status === 'revisado' && correction.status !== 'revisado'

  // Pontuação consolidada (Subtarefa 2): correção que acabou de fechar
  // enfileira o job idempotente de pontuação da prova. Best-effort — a
  // correção já está salva, e o gatilho de 'marcar_corrigido' na prova
  // cobre qualquer job que falhe em entrar aqui.
  if (shouldClassifySoloObserved) {
    try {
      await enqueuePontuarProvaJob(examId, currentUser.id)
    } catch (err) {
      console.warn('[corrections] falha ao enfileirar pontuação (segue sem):', err instanceof Error ? err.message : err)
    }
  }
  await updateExamCorrectionStatus(examId)

  if (shouldClassifySoloObserved) {
    try {
      const soloObserved = await persistSoloObservedForCorrection({
        examId,
        correctionId,
        answers,
        payload: exam.generationPayload as ExamGenerationResult,
        createdBy: currentUser.id,
        modelProvider: 'deepseek',
        modelName: process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash',
        promptVersion: 'solo-observed-v1',
      })
      soloObservedClassificationsCreated = soloObserved.created.length
      warnings.push(...soloObserved.warnings)
    } catch (err) {
      console.error('[corrections] erro ao persistir SOLO_OBSERVED:', err)
      warnings.push('Correção salva, mas houve erro ao classificar SOLO_OBSERVED das respostas discursivas.')
    }
  }

  return NextResponse.json({ correction: updated, warnings, soloObservedClassificationsCreated })
}

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ examId: string; correctionId: string }> }
) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(params.examId)
  const correctionId = Number(params.correctionId)
  if (!Number.isFinite(examId) || !Number.isFinite(correctionId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
  if (!exam) return NextResponse.json({ error: 'Prova não encontrada' }, { status: 404 })

  const isCoordenacao = isStaffSuperuser(currentUser.role)
  if (!isCoordenacao && exam.assignedTo !== currentUser.id) {
    return NextResponse.json({ error: 'Você não tem permissão pra corrigir essa prova.' }, { status: 403 })
  }

  await db.delete(examCorrections).where(eq(examCorrections.id, correctionId))
  return NextResponse.json({ ok: true })
}
