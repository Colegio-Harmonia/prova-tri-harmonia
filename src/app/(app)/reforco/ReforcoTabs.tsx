'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import StatusTabs from '../status/StatusTabs'
import ReforcoForm from './ReforcoForm'

type ReforcoTabsProps = {
  currentUserId: number | null
  isSuperuser: boolean
}

const TABS = [
  { key: 'criar', label: 'Criar reforço' },
  { key: 'acompanhar', label: 'Acompanhar reforços' },
] as const

export default function ReforcoTabs({ currentUserId, isSuperuser }: ReforcoTabsProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('modo') === 'acompanhar' ? 'acompanhar' : 'criar'

  function selectTab(tab: typeof activeTab) {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('aba')

    if (tab === 'acompanhar') params.set('modo', 'acompanhar')
    else params.delete('modo')

    const query = params.toString()
    router.replace(query ? `/reforco?${query}` : '/reforco', { scroll: false })
  }

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Seções de Reforço ENEM" className="flex gap-1 border-b border-border">
        {TABS.map((tab) => {
          const active = tab.key === activeTab
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(tab.key)}
              className={`min-h-10 border-b-2 px-4 text-sm font-medium transition-colors ${
                active
                  ? 'border-harmonia-green text-harmonia-green'
                  : 'border-transparent text-content-secondary hover:text-content-primary'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'criar' ? (
        <ReforcoForm />
      ) : (
        <StatusTabs currentUserId={currentUserId} isSuperuser={isSuperuser} examKind="reforco_enem" basePath="/reforco" />
      )}
    </div>
  )
}
