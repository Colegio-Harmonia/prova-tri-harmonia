import { redirect } from 'next/navigation'
import { auth } from '@/auth/auth'
import { isStaffSuperuser } from '@/lib/auth/roles'
import AiOperationsPanel from './AiOperationsPanel'

export default async function IaPage() {
  const session = await auth()
  if (!isStaffSuperuser(session?.user?.role ?? '')) redirect('/dashboard')

  return <AiOperationsPanel />
}
