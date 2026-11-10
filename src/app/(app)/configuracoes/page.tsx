import { redirect } from 'next/navigation'
import { auth } from '@/auth/auth'
import { isStaffSuperuser } from '@/lib/auth/roles'
import AcervoSettingsForm from './AcervoSettingsForm'

export default async function SettingsPage() {
  const session = await auth()
  if (!isStaffSuperuser(session?.user?.role ?? '')) redirect('/dashboard')
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-content-primary">Configurações</h1>
        <p className="mt-2 text-sm text-content-secondary">Gerencie as conexões do Prova-TRI.</p>
      </div>
      <AcervoSettingsForm />
    </div>
  )
}
