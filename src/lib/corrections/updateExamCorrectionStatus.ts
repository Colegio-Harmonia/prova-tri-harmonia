import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { getExamCompletionSummary } from './examCompletion'

// O status é calculado a partir de dados reais de correção, nunca marcado
// manualmente. Quando há cartões, eles formam o denominador congelado da
// turma; em provas sem cartões usamos as correções já cadastradas.
export async function updateExamCorrectionStatus(examId: number) {
  const summary = await getExamCompletionSummary(examId)
  if (!summary.expected) return
  const targetStatus = summary.completed >= summary.expected
    ? 'corrigido'
    : summary.completed > 0
      ? 'parcialmente_corrigida'
      : 'aplicado'
  await db.update(generatedExams)
    .set({
      status: targetStatus,
      correctedAt: summary.completed >= summary.expected ? new Date() : null,
    })
    .where(and(eq(generatedExams.id, examId), inArray(generatedExams.status, ['aplicado', 'parcialmente_corrigida', 'corrigido'])))
}
