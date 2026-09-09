'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { AppNavigation } from '@/components/layout/AppNavigation'

type MobileNavigationProps = {
  isSuperuser: boolean
  children: ReactNode
}

export function MobileNavigation({ isSuperuser, children }: MobileNavigationProps) {
  const [isOpen, setIsOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !isOpen) return

      setIsOpen(false)
      buttonRef.current?.focus()
    }

    window.addEventListener('keydown', closeWithEscape)
    return () => window.removeEventListener('keydown', closeWithEscape)
  }, [isOpen])

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-controls="mobile-navigation-panel"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className="flex min-h-10 items-center gap-2 rounded-md border border-border px-3 text-sm font-semibold text-content-primary transition-colors hover:bg-surface-subtle focus-visible:outline-none"
      >
        {isOpen ? <X aria-hidden="true" className="h-4 w-4" /> : <Menu aria-hidden="true" className="h-4 w-4" />}
        {isOpen ? 'Fechar menu' : 'Menu'}
      </button>

      {isOpen && (
        <div
          id="mobile-navigation-panel"
          className="absolute right-0 top-[calc(100%+0.75rem)] w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-surface shadow-raised"
        >
          <AppNavigation isSuperuser={isSuperuser} mobile onNavigate={() => setIsOpen(false)} />
          {children}
        </div>
      )}
    </div>
  )
}
