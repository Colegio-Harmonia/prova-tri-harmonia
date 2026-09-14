'use client'

import { useState, type ReactNode } from 'react'

export type Tab = { id: string; label: string; content: ReactNode }

export function Tabs({ tabs, defaultTab }: { tabs: Tab[]; defaultTab?: string }) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id)
  const activeTab = tabs.find((t) => t.id === active) ?? tabs[0]

  if (!tabs.length) return null

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab?.id === t.id
                ? 'border-harmonia-green text-harmonia-green'
                : 'border-transparent text-content-muted hover:text-content-secondary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="pt-4">{activeTab?.content}</div>
    </div>
  )
}
