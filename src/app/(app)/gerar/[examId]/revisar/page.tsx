import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import RevisarExam from './RevisarExam'

export default async function RevisarPage(props: { params: Promise<{ examId: string }> }) {
  const params = await props.params;
  const session = await auth()
  const currentUser = session?.user?.email
    ? await db.query.users.findFirst({ where: eq(users.email, session.user.email), columns: { id: true } })
    : null

  return (
    <RevisarExam
      examId={Number(params.examId)}
      currentUserRole={session?.user?.role ?? 'professor'}
      currentUserId={currentUser?.id ?? null}
    />
  )
}
