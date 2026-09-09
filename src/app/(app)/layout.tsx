import Link from 'next/link'
import Image from 'next/image'
import { auth, signOut } from '@/auth/auth'
import { AppNavigation } from '@/components/layout/AppNavigation'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { MobileNavigation } from '@/components/layout/MobileNavigation'
import { GenerationJobsProvider } from '@/components/queue/GenerationJobsProvider'
import { isStaffSuperuser } from '@/lib/auth/roles'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const isSuperuser = isStaffSuperuser(session?.user?.role ?? '')
  const userName = session?.user?.name ?? 'Conta'

  return (
    <GenerationJobsProvider>
    <div className="min-h-screen bg-canvas">
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-4 z-50 rounded bg-action-primary px-4 py-2 text-sm font-semibold text-action-primary-foreground focus:not-sr-only"
      >
        Pular para o conteúdo principal
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-border bg-surface lg:flex">
        <div className="border-b border-border px-5 py-5">
          <Link href="/dashboard" className="flex items-center gap-3 rounded-md focus-visible:outline-none">
            <Image src="/brand/harmonia-icon.png" alt="" width={48} height={48} priority className="h-12 w-12 shrink-0 object-contain" />
            <span>
              <span className="block text-base font-bold tracking-tight text-content-primary">Prova-TRI</span>
              <span className="block text-xs text-content-muted">Colégio Harmonia</span>
            </span>
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-5">
          <p className="mb-2 px-3 text-xs font-bold uppercase tracking-wider text-content-muted">Área de trabalho</p>
          <AppNavigation isSuperuser={isSuperuser} />
        </div>

        <div className="border-t border-border p-4">
          <p className="truncate px-3 text-sm font-medium text-content-primary">{userName}</p>
          <form
            className="mt-1"
            action={async () => {
              'use server'
              await signOut({ redirectTo: '/login' })
            }}
          >
            <button type="submit" className="min-h-10 rounded-md px-3 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary">
              Sair da conta
            </button>
          </form>
        </div>
      </aside>

      <div className="min-h-screen lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur lg:hidden">
          <div className="flex min-h-16 items-center justify-between gap-3 px-4 sm:px-6">
            <Link href="/dashboard" className="flex items-center gap-2 rounded-md focus-visible:outline-none">
              <Image src="/brand/harmonia-icon.png" alt="" width={36} height={36} priority className="h-9 w-9 object-contain" />
              <span>
                <span className="block text-sm font-bold tracking-tight text-content-primary">Prova-TRI</span>
                <span className="block text-xs text-content-muted">Colégio Harmonia</span>
              </span>
            </Link>

            <MobileNavigation isSuperuser={isSuperuser}>
              <div className="border-t border-border px-3 py-3">
                <p className="truncate px-3 text-sm font-medium text-content-primary">{userName}</p>
                <form
                  className="mt-1"
                  action={async () => {
                    'use server'
                    await signOut({ redirectTo: '/login' })
                  }}
                >
                  <button type="submit" className="min-h-10 rounded-md px-3 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-subtle hover:text-content-primary">
                    Sair da conta
                  </button>
                </form>
              </div>
            </MobileNavigation>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="mx-auto min-h-[calc(100vh-5rem)] max-w-[1200px] px-4 py-5 sm:px-6 sm:py-8 lg:min-h-[calc(100vh-4rem)] lg:px-10 lg:py-10">
          <Breadcrumbs />
          {children}
        </main>

        <footer className="mx-auto max-w-[1200px] border-t border-border px-4 py-5 text-xs text-content-muted sm:px-6 lg:px-10">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <span>Prova-TRI</span>
            <span>Colégio Harmonia</span>
          </div>
        </footer>
      </div>
    </div>
    </GenerationJobsProvider>
  )
}
