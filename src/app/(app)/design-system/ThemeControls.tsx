'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { isThemePreference, THEME_PREFERENCE_KEY, type ThemePreference } from '@/lib/theme'

const options: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
]

export default function ThemeControls() {
  const [theme, setTheme] = useState<ThemePreference>('system')
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const storedTheme = localStorage.getItem(THEME_PREFERENCE_KEY)
    if (isThemePreference(storedTheme)) {
      setTheme(storedTheme)
    }
    setIsReady(true)
  }, [])

  useEffect(() => {
    if (!isReady) return

    if (theme === 'system') {
      delete document.documentElement.dataset.theme
    } else {
      document.documentElement.dataset.theme = theme
    }

    localStorage.setItem(THEME_PREFERENCE_KEY, theme)
  }, [isReady, theme])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" aria-label="Visualizacao do tema">
        {options.map((option) => (
          <Button
            key={option.value}
            variant={theme === option.value ? 'primary' : 'secondary'}
            size="sm"
            aria-pressed={theme === option.value}
            onClick={() => setTheme(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <p className="text-sm text-content-muted">A preferencia fica salva somente neste navegador.</p>
    </div>
  )
}
