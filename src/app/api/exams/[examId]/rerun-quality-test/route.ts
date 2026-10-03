import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { planIdFromExamPayload } from '@/lib/curriculum/planCurriculum'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { qualityApprovalBlocks } from '@/lib/exams/questionQualityTest'
import { recomputeQualityReport } from '@/lib/exams/qualityReport'

// Mesma janela de edição das demais ações de revisão.
const EDITABLE_STATUSES = ['rascunho', 'atribuido', 'em_andamento', 'revisao_concluida', 'em_revisao']

/** Reaudita a prova inteira sob demanda, sem alterar as questões. */
export async function POST(_req: NextRequest, props: { params: Promise<{ examId: string }> }) {
  const { examId: rawExamId } = await props.params
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const examId = Number(rawExamId)
  if (!Number.isSafeInteger(examId) || examId <= 0) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const access = await authorizeExamAccess(examId, session.user.email)
  if ('error' in access) return access.error
  const { exam } = access
  if (!EDITABLE_STATUSES.includes(exam.status)) {
    return NextResponse.json({ error: 'Só é possível reauditar a prova antes de ela ser aprovada.' }, { status: 409 })
  }

  try {
    const curriculum = await getCurriculumForExam({
      segment: exam.segment,
      gradeYear: exam.gradeYear,
      subject: exam.subject,
      bimester: exam.bimester ?? undefined,
      curriculumPlanId: planIdFromExamPayload(exam.generationPayload),
    })
    const payload = exam.generationPayload as ExamGenerationResult
    const recomputed = await recomputeQualityReport({
      payload,
      curriculum,
      phase: 'Auditoria solicitada na revisão',
      preserveReports: true,
    })
    await db.update(generatedExams).set({ generationPayload: recomputed.payload }).where(eq(generatedExams.id, examId))
    return NextResponse.json({
      ok: true,
      qualityBlocks: qualityApprovalBlocks(recomputed.payload),
      qualityTest: recomputed.payload.metadata.qualityTest,
    })
  } catch (error) {
    console.error('[exams/rerun-quality-test] erro:', error)
    return NextResponse.json({ error: 'Não foi possível reexecutar a auditoria de qualidade.' }, { status: 502 })
  }
}
