'use client'

import { useEffect, useState } from 'react'

export type ResolvedTheme = 'light' | 'dark'

// O tema pode vir da preferencia explicita (`data-theme`) ou do sistema.
// Componentes dirigidos por JS (ApexCharts) precisam do valor resolvido em
// runtime, porque nao conseguem ler CSS variables sozinhos.
function readTheme(): ResolvedTheme {
  const explicit = document.documentElement.dataset.theme
  if (explicit === 'light' || explicit === 'dark') return explicit
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>('light')

  useEffect(() => {
    const update = () => setTheme(readTheme())
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', update)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', update)
    }
  }, [])

  return theme
}
