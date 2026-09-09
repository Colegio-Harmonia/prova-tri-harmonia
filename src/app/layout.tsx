import type { Metadata } from 'next'
import { THEME_PREFERENCE_KEY } from '@/lib/theme'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Prova-TRI — Colégio Harmonia',
  description: 'Gerador de provas alinhado a BNCC, Bloom e SAEB/ENEM',
}

const themeBootstrapScript = `
  try {
    const theme = localStorage.getItem('${THEME_PREFERENCE_KEY}')
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.dataset.theme = theme
    }
  } catch {}
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
