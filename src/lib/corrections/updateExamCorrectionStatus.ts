import { and, count, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { examCorrections, examSheetAssignments, generatedExams } from '@/db/schema'

// O status é calculado a partir de dados reais de correção, nunca marcado
// manualmente. Quando há cartões, eles formam o denominador congelado da
// turma; em provas sem cartões usamos as correções já cadastradas.
export async function updateExamCorrectionStatus(examId: number) {
  const [assignmentRow] = await db.select({ total: count() }).from(examSheetAssignments)
    .where(and(eq(examSheetAssignments.examId, examId), inArray(examSheetAssignments.status, ['pronta', 'emitida'])))
  const [correctionRow] = await db.select({ total: count(), reviewed: count() }).from(examCorrections)
    .where(and(eq(examCorrections.examId, examId), eq(examCorrections.status, 'revisado')))
  const [allCorrections] = await db.select({ total: count() }).from(examCorrections).where(eq(examCorrections.examId, examId))
  const expected = Number(assignmentRow?.total ?? 0) || Number(allCorrections?.total ?? 0)
  const reviewed = Number(correctionRow?.total ?? 0)
  if (!expected || !reviewed) return
  await db.update(generatedExams)
    .set({ status: reviewed >= expected ? 'corrigido' : 'parcialmente_corrigida', ...(reviewed >= expected ? { correctedAt: new Date() } : {}) })
    .where(and(eq(generatedExams.id, examId), inArray(generatedExams.status, ['aplicado', 'parcialmente_corrigida', 'corrigido'])))
}
