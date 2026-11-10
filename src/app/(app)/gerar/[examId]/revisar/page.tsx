import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { redirect } from 'next/navigation'
import { authorizeExamAccess } from '@/lib/exams/authorizeExamAccess'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import ExamPlanCoverageNotice from './ExamPlanCoverageNotice'
import RevisarExam from './RevisarExam'

export default async function RevisarPage(props: { params: Promise<{ examId: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (session?.user?.email && Number.isSafeInteger(Number(params.examId))) {
    const access = await authorizeExamAccess(Number(params.examId), session.user.email)
    if (!('error' in access) && access.exam.status === 'rascunho' && (access.exam.generationPayload as ExamGenerationResult).metadata.creationMode === 'manual') redirect(`/gerar/manual/${params.examId}`)
  }
  const currentUser = session?.user?.email
    ? await db.query.users.findFirst({ where: eq(users.email, session.user.email), columns: { id: true } })
    : null

  return (
    <>
      <ExamPlanCoverageNotice examId={Number(params.examId)} userEmail={session?.user?.email} />
      <RevisarExam
        examId={Number(params.examId)}
        currentUserRole={session?.user?.role ?? 'professor'}
        currentUserId={currentUser?.id ?? null}
      />
    </>
  )
}
