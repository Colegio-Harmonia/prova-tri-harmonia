'use client'

import { useRef, type KeyboardEvent, type ReactNode } from 'react'

// Abas do relatório individual. Na tela mostra só a aba ativa; na impressão/PDF
// saem todas, em ordem, cada uma com o próprio título.
export const REPORT_TABS = [
  { id: 'resumo', label: 'Resumo' },
  { id: 'habilidades', label: 'Habilidades' },
  { id: 'evolucao', label: 'Evolução' },
  { id: 'avaliacoes', label: 'Avaliações' },
] as const
export type ReportTab = (typeof REPORT_TABS)[number]['id']

export function isReportTab(value: string | null): value is ReportTab {
  return REPORT_TABS.some((tab) => tab.id === value)
}

export function ReportTabs({ active, onChange }: { active: ReportTab; onChange: (tab: ReportTab) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = REPORT_TABS.length - 1
    const target = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0 : event.key === 'End' ? last : null
    if (target === null) return
    event.preventDefault()
    onChange(REPORT_TABS[target].id)
    refs.current[target]?.focus()
  }
  return <div role="tablist" aria-label="Seções do relatório" className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto border-b border-border bg-canvas px-1 pt-1 print:hidden">
    {REPORT_TABS.map((tab, index) => {
      const selected = tab.id === active
      return <button key={tab.id} ref={(node) => { refs.current[index] = node }} type="button" role="tab" id={`aba-${tab.id}`} aria-selected={selected} aria-controls={`painel-${tab.id}`} tabIndex={selected ? 0 : -1}
        onClick={() => onChange(tab.id)} onKeyDown={(event) => onKeyDown(event, index)}
        className={`min-h-10 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${selected ? 'border-harmonia-green text-content-primary' : 'border-transparent text-content-secondary hover:text-content-primary'}`}>{tab.label}</button>
    })}
  </div>
}

export function ReportPanel({ id, active, children }: { id: ReportTab; active: ReportTab; children: ReactNode }) {
  const label = REPORT_TABS.find((tab) => tab.id === id)!.label
  // Todas as abas ficam montadas (dados carregados uma vez só e impressão completa).
  return <section role="tabpanel" id={`painel-${id}`} aria-labelledby={`aba-${id}`} className={`space-y-6 ${id === active ? '' : 'hidden print:block'} print:mt-6`}>
    <h2 className="hidden text-xl font-bold text-content-primary print:block">{label}</h2>
    {children}
  </section>
}
