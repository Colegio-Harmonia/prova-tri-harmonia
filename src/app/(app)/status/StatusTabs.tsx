'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import StatusList from './StatusList'
import QueueList from './QueueList'
import type { ExamKind } from '@/db/schema'

const PROOF_JOB_TYPES = ['gerar_prova', 'adaptar_prova']
const REINFORCEMENT_JOB_TYPES = ['gerar_reforco_enem']
const ACTIVITY_JOB_TYPES = ['gerar_atividade']

// A mesma interface atende coleções diferentes. A aba ativa vive na query
// string (?aba=fila), o que preserva deep-links do toast e da geração.

export default function StatusTabs({
  currentUserId,
  isSuperuser,
  examKind = 'prova',
  basePath = '/status',
  singleView,
}: {
  currentUserId: number | null
  isSuperuser: boolean
  examKind?: ExamKind
  basePath?: string
  // Páginas que já têm navegação própria podem escolher uma visão sem
  // renderizar uma segunda barra de abas.
  singleView?: 'list' | 'queue'
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab = singleView === 'queue' ? 'fila' : singleView === 'list' ? 'provas' : searchParams.get('aba') === 'fila' ? 'fila' : 'provas'
  const isPedagogicalActivity = examKind === 'atividade'
  const isReinforcement = examKind === 'reforco_enem'
  const isActivityCollection = isPedagogicalActivity || isReinforcement
  const collectionLabel = isPedagogicalActivity ? 'Atividades' : isReinforcement ? 'Reforços ENEM' : 'Provas'
  const singularLabel = isPedagogicalActivity ? 'atividade' : isReinforcement ? 'reforço ENEM' : 'prova'
  const trackingLabel = isPedagogicalActivity ? 'atividades' : isReinforcement ? 'reforços ENEM' : 'provas'
  const jobTypes = isPedagogicalActivity ? ACTIVITY_JOB_TYPES : isReinforcement ? REINFORCEMENT_JOB_TYPES : PROOF_JOB_TYPES
  const TABS = [
    { key: 'provas', label: collectionLabel },
    { key: 'fila', label: `Histórico e fila de ${trackingLabel}` },
  ] as const

  function tabHref(tab: typeof activeTab) {
    const params = new URLSearchParams(searchParams.toString())
    if (tab === 'fila') params.set('aba', 'fila')
    else params.delete('aba')
    const query = params.toString()
    return query ? `${basePath}?${query}` : basePath
  }

  return (
    <div className={singleView ? undefined : 'space-y-4'}>
      {!singleView && <div role="tablist" aria-label="Seções de acompanhamento" className="flex gap-1 border-b border-border">
        {TABS.map((tab) => {
          const active = tab.key === activeTab
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={active}
              onClick={() => router.replace(tabHref(tab.key), { scroll: false })}
              className={`min-h-10 border-b-2 px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/50 ${
                active
                  ? 'border-harmonia-green text-harmonia-green'
                  : 'border-transparent text-content-secondary hover:text-content-primary'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>}

      {activeTab === 'provas' ? (
        <StatusList
          currentUserId={currentUserId}
          isCoordenacao={isSuperuser}
          examKind={examKind}
          collectionLabel={isActivityCollection ? trackingLabel : undefined}
          singularLabel={isActivityCollection ? singularLabel : undefined}
        />
      ) : (
        <QueueList isSuperuser={isSuperuser} jobTypes={jobTypes} collectionLabel={trackingLabel} singularLabel={singularLabel} emptyHref={isPedagogicalActivity ? '/atividades' : isReinforcement ? '/reforco' : '/gerar'} />
      )}
    </div>
  )
}
