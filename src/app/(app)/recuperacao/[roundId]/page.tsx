import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import RoundDetail from './RoundDetail'

export default async function RecoveryRoundPage(props: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await props.params
  const session = await auth()
  const currentUser = session?.user?.email
    ? await db.query.users.findFirst({ where: eq(users.email, session.user.email), columns: { role: true } })
    : null
  return <RoundDetail roundId={Number(roundId)} isSuperuser={isStaffSuperuser(currentUser?.role ?? '')} />
}
