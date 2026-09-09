import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { examCorrections, generatedExams } from '@/db/schema'
import type { CorrectionAnswer } from '@/types/correction'
import { buildPercentualBreakdown, scorePercentual } from './percentualScorer'
import { buildTriEstimate, type TriItem } from './triScorer'
import { buildInternalEstimate, type InternalEstimateQuestion } from './internalEstimate'
import type { ScoreResult } from './scoringPolicy'

// Pontuação das correções de uma prova (job 'pontuar_prova', spec 1.5).
// Idempotente por design: recalcula e regrava score_result de TODA
// correção 'revisado' da prova — rodar duas vezes dá o mesmo resultado,
// então os gatilhos (revisar correção, marcar prova corrigida) podem
// enfileirar sem coordenação entre si.

type PayloadQuestion = {
  number: number
  type: 'objetiva' | 'descritiva'
  source?: string
  enemBankRef?: { questionId: number; year: number } | null
  pedagogicalClassification?: { difficulty?: 'facil' | 'media' | 'dificil' | null } | null
  review?: { difficulty?: 'facil' | 'adequada' | 'dificil' | null } | null
}

type TriParamsRow = { id: number; a: number; b: number; c: number; source: string }

// imported_questions é tabela externa ao Drizzle (criada por
// scripts/setup-enem-schema.ts) — leitura via SQL bruto, como no resto do
// código que a consulta.
async function fetchTriParams(questionIds: number[]): Promise<Map<number, TriParamsRow>> {
  if (!questionIds.length) return new Map()
  const rows = await db.execute(sql`
    SELECT id, tri_param_a, tri_param_b, tri_param_c, tri_param_source
    FROM imported_questions
    WHERE id IN (${sql.join(questionIds.map((id) => sql`${id}`), sql`, `)})
      AND tri_param_a IS NOT NULL AND tri_param_b IS NOT NULL AND tri_param_c IS NOT NULL
      AND tri_param_a > 0
  `)
  const map = new Map<number, TriParamsRow>()
  for (const row of rows as unknown as Array<Record<string, unknown>>) {
    map.set(Number(row.id), {
      id: Number(row.id),
      a: Number(row.tri_param_a),
      b: Number(row.tri_param_b),
      c: Number(row.tri_param_c),
      source: String(row.tri_param_source ?? 'desconhecida'),
    })
  }
  return map
}

export type ScoreCorrectionsResult = {
  examId: number
  method: 'percentual' | 'tri'
  scored: number
  calibratedItems?: number
  objectiveTotal?: number
}

export async function scoreExamCorrections(examId: number): Promise<ScoreCorrectionsResult> {
  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
  if (!exam) throw new Error(`Prova #${examId} não encontrada.`)

  const corrections = await db.query.examCorrections.findMany({
    where: and(eq(examCorrections.examId, examId), eq(examCorrections.status, 'revisado')),
  })

  const questions = ((exam.generationPayload as { questions?: PayloadQuestion[] })?.questions ?? [])
  const objectiveTotal = questions.filter((q) => q.type === 'objetiva').length
  const internalEstimateQuestions: InternalEstimateQuestion[] = questions.map((question) => ({
    number: question.number,
    source: question.source,
    difficulty: question.review?.difficulty ?? question.pedagogicalClassification?.difficulty ?? null,
  }))

  // Mapa questão-da-prova → item calibrado (só faz sentido em prova TRI).
  let calibratedByNumber = new Map<number, TriParamsRow>()
  if (exam.scoringMethod === 'tri') {
    const bankRefs = questions
      .filter((q) => q.type === 'objetiva' && q.enemBankRef?.questionId)
      .map((q) => ({ number: q.number, questionId: q.enemBankRef!.questionId }))
    const params = await fetchTriParams(bankRefs.map((r) => r.questionId))
    calibratedByNumber = new Map(
      bankRefs.flatMap((r) => {
        const p = params.get(r.questionId)
        return p ? [[r.number, p] as const] : []
      }),
    )
  }

  let scored = 0
  for (const correction of corrections) {
    const answers = (correction.answers ?? []) as CorrectionAnswer[]

    let scoreResult: ScoreResult
    const internalEstimate = buildInternalEstimate(answers, internalEstimateQuestions)
    if (exam.scoringMethod === 'tri') {
      const items: TriItem[] = []
      for (const answer of answers) {
        if (answer.type !== 'objetiva') continue // discursiva nunca entra na TRI (spec 1.4.5)
        const params = calibratedByNumber.get(answer.questionNumber)
        if (!params) continue
        items.push({ a: params.a, b: params.b, c: params.c, correct: answer.isCorrect === true })
      }
      const tri = buildTriEstimate(items, objectiveTotal)
      scoreResult = {
        method: 'tri',
        tri,
        noTriReason: tri
          ? null
          : 'Nenhuma questão da prova tem calibração TRI oficial (INEP/SAE) — exibindo apenas o percentual.',
        percentual: buildPercentualBreakdown(answers),
        internalEstimate,
      }
    } else {
      scoreResult = { ...scorePercentual(answers), internalEstimate }
    }

    await db.update(examCorrections).set({ scoreResult }).where(eq(examCorrections.id, correction.id))
    scored++
  }

  return {
    examId,
    method: exam.scoringMethod,
    scored,
    ...(exam.scoringMethod === 'tri' ? { calibratedItems: calibratedByNumber.size, objectiveTotal } : {}),
  }
}
