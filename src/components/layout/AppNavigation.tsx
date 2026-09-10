'use client'

import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  BarChart3,
  ClipboardList,
  FileText,
  FilePlus2,
  LayoutDashboard,
  Sparkles,
  ShieldCheck,
  Target,
  UsersRound,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/cn'
import { useGenerationJobs } from '@/components/queue/GenerationJobsProvider'

type NavigationItem = {
  href: string
  label: string
  icon: LucideIcon
}

const performanceViews = [
  { href: '/desempenho', label: 'Visão geral' },
  { href: '/desempenho?visao=bloom', label: 'Análise Bloom' },
  { href: '/desempenho?visao=dok', label: 'Análise DOK' },
  { href: '/desempenho?visao=bncc', label: 'Análise BNCC' },
  { href: '/desempenho?visao=perfis', label: 'Perfis cognitivos' },
  { href: '/desempenho/simulado-enem', label: 'Simulado ENEM' },
  { href: '/desempenho/simulado-enem/sae', label: 'SAE', nested: true },
]

const primaryItems: NavigationItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/gerar', label: 'Gerar prova', icon: FilePlus2 },
  { href: '/reforco', label: 'Reforço ENEM', icon: Target },
  { href: '/atividades', label: 'Atividades', icon: FileText },
  { href: '/status', label: 'Provas', icon: ClipboardList },
  { href: '/arquivadas', label: 'Arquivadas', icon: Archive },
  { href: '/turmas', label: 'Turmas', icon: UsersRound },
  { href: '/desempenho', label: 'Desempenho', icon: BarChart3 },
]

const managementItem: NavigationItem = {
  href: '/usuarios',
  label: 'Usuários',
  icon: ShieldCheck,
}

const aiManagementItem: NavigationItem = { href: '/ia', label: 'Operações de IA', icon: Sparkles }

function isCurrentRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

type AppNavigationProps = {
  isSuperuser: boolean
  mobile?: boolean
  onNavigate?: () => void
}

export function AppNavigation({ isSuperuser, mobile = false, onNavigate }: AppNavigationProps) {
  const pathname = usePathname()
  // Badges separam a fila de provas da fila de atividades formativas.
  const { activeProofCount, activeActivityCount, activeReinforcementCount } = useGenerationJobs()
  const items = isSuperuser ? [...primaryItems, managementItem, aiManagementItem] : primaryItems

  return (
    <nav aria-label="Navegação principal" className={cn('flex flex-col gap-1', mobile && 'p-3')}>
      {items.map((item) => {
        const active = isCurrentRoute(pathname, item.href)
        const Icon = item.icon

        return (
          <div key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              onClick={onNavigate}
              className={cn(
                'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-fast ease-productive',
                active
                  ? 'bg-surface-subtle text-harmonia-green'
                  : 'text-content-secondary hover:bg-surface-subtle hover:text-content-primary',
              )}
            >
              <Icon aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={1.8} />
              <span>{item.label}</span>
              {item.href === '/status' && activeProofCount > 0 && (
                <span
                  aria-label={`${activeProofCount} geração(ões) de prova em andamento`}
                  className="ml-auto rounded-full bg-harmonia-green px-2 py-0.5 text-xs font-semibold text-white"
                >
                  {activeProofCount}
                </span>
              )}
              {item.href === '/reforco' && activeReinforcementCount > 0 && (
                <span
                  aria-label={`${activeReinforcementCount} geração(ões) de reforço ENEM em andamento`}
                  className="ml-auto rounded-full bg-harmonia-green px-2 py-0.5 text-xs font-semibold text-white"
                >
                  {activeReinforcementCount}
                </span>
              )}
              {item.href === '/atividades' && activeActivityCount > 0 && (
                <span aria-label={`${activeActivityCount} geração(ões) de atividade em andamento`} className="ml-auto rounded-full bg-harmonia-green px-2 py-0.5 text-xs font-semibold text-white">{activeActivityCount}</span>
              )}
            </Link>
            {item.href === '/desempenho' && isSuperuser && (
              <div className="ml-8 mt-1 flex flex-col gap-1 border-l border-border pl-3">
                {performanceViews.map((view) => (
                  <Link key={view.href} href={view.href} onClick={onNavigate} className={cn('min-h-8 py-1 text-xs text-content-secondary hover:text-harmonia-green', view.nested && 'pl-3')}>
                    {view.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}
