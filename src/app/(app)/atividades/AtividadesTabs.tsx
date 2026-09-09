'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import StatusTabs from '../status/StatusTabs'
import AtividadeForm from './AtividadeForm'

const TABS = [
  { key: 'criar', label: 'Criar atividade' },
  { key: 'atividades', label: 'Atividades' },
  { key: 'fila', label: 'Histórico e fila' },
] as const

type ActivityTab = (typeof TABS)[number]['key']

export default function AtividadesTabs({ currentUserId, isSuperuser }: { currentUserId: number | null; isSuperuser: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const mode = searchParams.get('modo')
  // Mantém links já compartilhados antes deste ajuste: acompanhar + aba=fila
  // abre a nova aba única de histórico; acompanhar sem aba abre a listagem.
  const activeTab: ActivityTab = mode === 'fila' || (mode === 'acompanhar' && searchParams.get('aba') === 'fila')
    ? 'fila'
    : mode === 'atividades' || mode === 'acompanhar'
      ? 'atividades'
      : 'criar'

  function selectTab(tab: ActivityTab) {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('aba')
    if (tab === 'criar') params.delete('modo')
    else params.set('modo', tab)
    const query = params.toString()
    router.replace(query ? `/atividades?${query}` : '/atividades', { scroll: false })
  }

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Seções de Atividades" className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((tab) => {
          const active = tab.key === activeTab
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(tab.key)}
              className={`min-h-10 border-b-2 px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/50 ${
                active ? 'border-harmonia-green text-harmonia-green' : 'border-transparent text-content-secondary hover:text-content-primary'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'criar' ? (
        <AtividadeForm />
      ) : (
        <StatusTabs
          currentUserId={currentUserId}
          isSuperuser={isSuperuser}
          examKind="atividade"
          basePath="/atividades"
          singleView={activeTab === 'fila' ? 'queue' : 'list'}
        />
      )}
    </div>
  )
}
