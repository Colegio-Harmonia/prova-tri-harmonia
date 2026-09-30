import { NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { examPlanCoverage } from '@/lib/curriculum/operations'
import { findPlanForScope, plannedSkillsByPlan } from '@/lib/curriculum/operationsData'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

// Bloco 8.1: avisa quando a prova não cobre habilidades planejadas do bimestre.
export async function GET(_req: Request, { params }: { params: Promise<{ examId: string }> }) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const { examId } = await params
  const access = await authorizeExamAccess(Number(examId), session.user.email)
  if ('error' in access) return access.error
  const { exam } = access
  if (!exam.bimester) return NextResponse.json({ available: false, reason: 'Prova sem bimestre definido.' })
  const plan = await findPlanForScope({ academicYear: exam.academicYear, segment: exam.segment, gradeYear: exam.gradeYear, subject: exam.subject, bimester: exam.bimester })
  if (!plan) return NextResponse.json({ available: false, reason: 'Não há planejamento cadastrado para este recorte.' })
  const planned = (await plannedSkillsByPlan([plan.id])).get(plan.id) ?? []
  const questions = ((exam.generationPayload as ExamGenerationResult).questions ?? []).map((question) => question.bnccStatus === 'mapeado' && Array.isArray(question.bnccCodes) ? question.bnccCodes : [])
  return NextResponse.json({ available: true, planId: plan.id, ...examPlanCoverage(planned, questions) })
}
