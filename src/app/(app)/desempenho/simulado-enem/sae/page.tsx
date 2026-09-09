import { redirect } from 'next/navigation'
import { auth } from '@/auth/auth'
import { isStaffSuperuser } from '@/lib/auth/roles'
import EnemSaeImport from '../enem-sae-import'

export default async function EnemSaePage() {
  const session = await auth()
  if (!isStaffSuperuser(session?.user?.role ?? '')) redirect('/desempenho')

  return <EnemSaeImport />
}
