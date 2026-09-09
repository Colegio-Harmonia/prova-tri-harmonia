import { NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { SEGMENT_LABELS } from '@/config/subjects'
import type { Segment } from '@/types/exam'
import { BLOOM_LEVELS } from '@/lib/gemini/examSchema'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const rows = await db.query.generatedExams.findMany()

  const total = rows.length
  const byStatus: Record<string, number> = { rascunho: 0, atribuido: 0, em_andamento: 0, revisao_concluida: 0, aprovado: 0, impresso: 0, aplicado: 0, corrigido: 0 }
  const bySegment: Record<Segment, number> = { 'anos-iniciais': 0, 'anos-finais': 0, 'ensino-medio': 0 }
  const byGrade: Record<string, number> = {}
  const bySubject: Record<string, number> = {}
  const bloomCounts: Record<string, number> = Object.fromEntries(BLOOM_LEVELS.map((l) => [l, 0]))

  let totalQuestions = 0
  let bnccMapped = 0
  let questionsNeedingImage = 0
  let imagesApproved = 0

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
    bySegment[row.segment] = (bySegment[row.segment] ?? 0) + 1

    const gradeLabel = `${row.gradeYear}º ano`
    byGrade[gradeLabel] = (byGrade[gradeLabel] ?? 0) + 1
    bySubject[row.subject] = (bySubject[row.subject] ?? 0) + 1

    const payload = row.generationPayload as ExamGenerationResult
    for (const q of payload?.questions ?? []) {
      totalQuestions++
      if (q.bnccStatus === 'mapeado') bnccMapped++
      if (q.bloomLevel) bloomCounts[q.bloomLevel] = (bloomCounts[q.bloomLevel] ?? 0) + 1
      if (q.needsImage) questionsNeedingImage++
      if (q.image?.approved) imagesApproved++
    }
  }

  return NextResponse.json({
    total,
    byStatus,
    bySegment: Object.fromEntries(
      (Object.keys(bySegment) as Segment[]).map((s) => [SEGMENT_LABELS[s], bySegment[s]]),
    ),
    byGrade,
    bySubject,
    bloomCounts,
    totalQuestions,
    bnccMappedPct: totalQuestions ? Math.round((bnccMapped / totalQuestions) * 100) : 0,
    questionsNeedingImage,
    imagesApproved,
  })
}
