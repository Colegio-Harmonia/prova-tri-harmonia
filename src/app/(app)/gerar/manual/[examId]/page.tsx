import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth/auth'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import { presentAcervoExam } from '@/lib/exams/acervoPresentation'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import ManualExamBuilder from './ManualExamBuilder'
import { loadManualPlanningGuide, type ManualPlanningGuide } from '@/lib/exams/manualPlanningGuide'

export default async function ManualExamPage({ params }: { params: Promise<{ examId: string }> }) {
  const session = await auth()
  if (!session?.user?.email) redirect('/login')
  const examId = Number((await params).examId)
  if (!Number.isSafeInteger(examId) || examId <= 0) notFound()
  const access = await authorizeExamAccess(examId, session.user.email)
  if ('error' in access) notFound()
  const payload = access.exam.generationPayload as ExamGenerationResult
  if (payload.metadata.creationMode !== 'manual') notFound()
  if (access.exam.status !== 'rascunho') redirect(`/gerar/${examId}/revisar`)
  let planningGuide: ManualPlanningGuide
  try { planningGuide = await loadManualPlanningGuide(access.exam) }
  catch { console.warn('[exams/manual] planejamento indisponível', { examId }); planningGuide = { plans: [], unavailable: true } }
  return <ManualExamBuilder examId={examId} initialExam={presentAcervoExam(payload)} planningGuide={planningGuide} />
}
