import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams, examCorrections, users } from '@/db/schema'
import { auth } from '@/auth/auth'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import type { CorrectionAnswer } from '@/types/correction'
import { suggestGrade } from '@/lib/gemini/gradeSuggestion'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { aiFailureResponse } from '@/lib/ai/routeFailure'
import { questionMaxGrade } from '@/lib/corrections/gradeNormalization'

const AI_SUGGESTION_CONCURRENCY = 2

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []

  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency)
    results.push(...(await Promise.all(batch.map(worker))))
  }

  return results
}

// Gera a sugestão da IA pra todas as questões descritivas dessa correção
// que já têm resposta transcrita mas ainda não têm sugestão. A sugestão
// preenche a nota final quando o professor ainda não informou uma nota;
// uma nota manual existente sempre tem prioridade.
export async function POST(
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

  const correction = await db.query.examCorrections.findFirst({ where: eq(examCorrections.id, correctionId) })
  if (!correction || correction.examId !== examId) return NextResponse.json({ error: 'Correção não encontrada' }, { status: 404 })

  const payload = exam.generationPayload as ExamGenerationResult
  const answers = correction.answers as CorrectionAnswer[]

  // Corrige registros antigos em que a sugestão foi salva no card, mas não
  // chegou ao campo finalGrade usado pelo input da tela.
  const answersWithExistingSuggestions = answers.map((a) =>
    a.type === 'descritiva' && a.finalGrade == null && a.aiSuggestedGrade !== null
      ? { ...a, finalGrade: a.aiSuggestedGrade }
      : a,
  )
  const hasBackfilledGrades = answersWithExistingSuggestions.some(
    (answer, index) => answer.finalGrade !== answers[index]?.finalGrade,
  )
  const pending = answersWithExistingSuggestions.filter((a) => a.type === 'descritiva' && a.transcribedAnswer.trim() && a.aiSuggestedGrade === null)
  if (pending.length === 0) {
    if (!hasBackfilledGrades) return NextResponse.json({ correction, suggested: 0 })
    const [updated] = await db
      .update(examCorrections)
      .set({ answers: answersWithExistingSuggestions, updatedAt: new Date() })
      .where(eq(examCorrections.id, correctionId))
      .returning()
    return NextResponse.json({ correction: updated, suggested: 0 })
  }

  let suggestions: Array<{ questionNumber: number; suggestion: Awaited<ReturnType<typeof suggestGrade>> }>
  try {
    suggestions = await mapWithConcurrency(
      pending,
      AI_SUGGESTION_CONCURRENCY,
      async (a) => {
      const question = payload.questions.find((q) => q.number === a.questionNumber)
        if (!question) throw new Error('Questão descritiva não encontrada na prova.')
        const suggestion = await suggestGrade({
          statement: question.statement,
          expectedAnswer: question.expectedAnswer ?? null,
          gradingCriteria: question.gradingCriteria ?? null,
          studentAnswer: a.transcribedAnswer,
          maxGrade: questionMaxGrade(question),
        })
        return { questionNumber: a.questionNumber, suggestion }
      },
    )
  } catch (err) {
    console.error('[corrections/suggest] nenhuma sugestão foi salva:', err instanceof Error ? err.name : 'erro desconhecido')
    return aiFailureResponse(err, 'A IA não conseguiu gerar sugestões válidas. Nenhuma sugestão foi salva; tente novamente.')
  }

  const bySuggestion = new Map(suggestions.map((s) => [s.questionNumber, s.suggestion]))
  const updatedAnswers: CorrectionAnswer[] = answersWithExistingSuggestions.map((a) => {
    const s = bySuggestion.get(a.questionNumber)
    if (!s) return a
    return {
      ...a,
      weight: a.weight ?? questionMaxGrade(payload.questions.find((question) => question.number === a.questionNumber)!),
      aiSuggestedRawGrade: s.rawGrade,
      aiSuggestedGradeScale: s.sourceScale,
      aiSuggestedGrade: s.grade,
      aiSuggestedFeedback: s.feedback,
      finalGrade: a.finalGrade ?? s.grade,
    }
  })

  const [updated] = await db
    .update(examCorrections)
    .set({ answers: updatedAnswers, updatedAt: new Date() })
    .where(eq(examCorrections.id, correctionId))
    .returning()

  return NextResponse.json({ correction: updated, suggested: bySuggestion.size })
}
