'use client'

import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Crumb = {
  href?: string
  label: string
}

function getBreadcrumbs(pathname: string): Crumb[] {
  if (pathname === '/dashboard') {
    return [{ label: 'Dashboard' }]
  }

  if (pathname.startsWith('/gerar/')) {
    if (pathname.endsWith('/revisar')) {
      return [{ label: 'Revisar avaliação' }]
    }

    if (pathname.endsWith('/corrigir')) {
      return [{ href: '/status', label: 'Provas' }, { label: 'Corrigir prova' }]
    }
  }

  const current = [
    { href: '/gerar', label: 'Gerar prova' },
    { href: '/status', label: 'Provas' },
    { href: '/atividades', label: 'Atividades' },
    { href: '/turmas', label: 'Minhas turmas' },
    { href: '/desempenho', label: 'Desempenho' },
    { href: '/usuarios', label: 'Usuários' },
    { href: '/ia', label: 'Operações de IA' },
    { href: '/design-system', label: 'Design System' },
  ].find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))

  if (!current) {
    return [{ label: 'Prova-TRI' }]
  }

  if (pathname.startsWith('/turmas/') || pathname.startsWith('/usuarios/')) {
    return [{ href: current.href, label: current.label }, { label: 'Detalhes' }]
  }

  return [{ label: current.label }]
}

export function Breadcrumbs() {
  const pathname = usePathname()
  const crumbs = getBreadcrumbs(pathname)

  return (
    <nav aria-label="Breadcrumb" className="mb-5 overflow-x-auto">
      <ol className="flex min-w-max items-center gap-1 text-sm text-content-muted">
        <li>
          <Link href="/dashboard" className="transition-colors hover:text-harmonia-green">
            Início
          </Link>
        </li>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1

          return (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-content-muted" />
              {crumb.href && !isLast ? (
                <Link href={crumb.href} className="transition-colors hover:text-harmonia-green">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={isLast ? 'page' : undefined} className={isLast ? 'font-medium text-content-secondary' : undefined}>
                  {crumb.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
