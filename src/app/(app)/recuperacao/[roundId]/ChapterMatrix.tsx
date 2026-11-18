'use client'

import { useRef } from 'react'
import type { RecoveryContentPlanItem } from '@/db/schema'

// Matriz por capítulo de um aluno: a mesma "Distribuição planejada por
// capítulo" da tela Gerar prova (barra arrastável ou setas), mostrando quais
// habilidades fracas do aluno cada capítulo trabalha.

export type Chapter = { rowIndex: number; title: string; content: string | null; bimester: number | null; codes: string[] }

function questionsFromPointer(element: HTMLElement, clientX: number, total: number): number {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || total <= 0) return 0
  return Math.max(0, Math.min(total, Math.round(((clientX - rect.left) / rect.width) * total)))
}

export default function ChapterMatrix({ chapters, weakCodes, plan, total, disabled, onChange, onReset }: {
  chapters: Chapter[]; weakCodes: string[]; plan: RecoveryContentPlanItem[]; total: number; disabled: boolean
  onChange: (plan: RecoveryContentPlanItem[]) => void; onReset: () => void
}) {
  const dragging = useRef<number | null>(null)
  const weak = new Set(weakCodes.map((code) => code.toUpperCase()))
  const counts = new Map(plan.map((item) => [item.unitRowIndex, item.questionCount]))
  const planned = plan.reduce((sum, item) => sum + item.questionCount, 0)
  // Capítulos com habilidade fraca primeiro; os demais ficam disponíveis, recolhidos no fim.
  const relevant = chapters.filter((chapter) => chapter.codes.some((code) => weak.has(code)) || (counts.get(chapter.rowIndex) ?? 0) > 0)
  const others = chapters.filter((chapter) => !relevant.includes(chapter))

  const setCount = (rowIndex: number, value: number) => {
    const next = Math.max(0, Math.min(total, value))
    const rest = plan.filter((item) => item.unitRowIndex !== rowIndex)
    onChange(next > 0 ? [...rest, { unitRowIndex: rowIndex, questionCount: next, priority: 'alta' as const, visualAid: 'auto' as const }].sort((a, b) => a.unitRowIndex - b.unitRowIndex) : rest)
  }

  const row = (chapter: Chapter) => {
    const count = counts.get(chapter.rowIndex) ?? 0
    const weakHere = chapter.codes.filter((code) => weak.has(code))
    return <li key={chapter.rowIndex} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(200px,2fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-content-primary">{chapter.bimester ? `${chapter.bimester}º bim. · ` : ''}{chapter.title}</p>
        {weakHere.length > 0
          ? <p className="line-clamp-1 text-[11px] text-status-warning-content">Fracas: {weakHere.join(', ')}</p>
          : chapter.content && <p className="line-clamp-1 text-[11px] text-content-muted">{chapter.content}</p>}
      </div>
      <div role="slider" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={`Número de questões de ${chapter.title}`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={count} aria-valuetext={`${count} questão(ões)`}
        onPointerDown={(event) => { if (disabled) return; dragging.current = chapter.rowIndex; event.currentTarget.setPointerCapture(event.pointerId); setCount(chapter.rowIndex, questionsFromPointer(event.currentTarget, event.clientX, total)) }}
        onPointerMove={(event) => { if (dragging.current === chapter.rowIndex) setCount(chapter.rowIndex, questionsFromPointer(event.currentTarget, event.clientX, total)) }}
        onPointerUp={(event) => { dragging.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
        onPointerCancel={() => { dragging.current = null }}
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); setCount(chapter.rowIndex, count + 1) }
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); setCount(chapter.rowIndex, count - 1) }
          else if (event.key === 'Home') { event.preventDefault(); setCount(chapter.rowIndex, 0) }
        }}
        style={{ touchAction: 'none' }}
        className={`relative flex h-7 items-center rounded bg-surface ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${disabled ? 'opacity-70' : 'cursor-ew-resize'}`}>
        <div className="relative h-full" style={{ width: `${total > 0 ? (count / total) * 100 : 0}%`, minWidth: count > 0 ? '1.75rem' : 0 }}>
          <div className="flex h-full items-center justify-end rounded-l pr-2.5" style={{ backgroundColor: 'rgb(var(--color-action-primary))' }}>
            {count > 0 && <span className="text-[11px] font-semibold leading-none text-action-primary-foreground">{count}</span>}
          </div>
          <span aria-hidden="true" className="absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 translate-x-1/2 rounded-full border-2 border-surface shadow-soft" style={{ backgroundColor: 'rgb(var(--color-action-primary))' }} />
        </div>
      </div>
      <span className="justify-self-start rounded bg-harmonia-green/10 px-2 py-1 text-center text-xs font-semibold text-harmonia-green sm:justify-self-end">{count} questão(ões)</span>
    </li>
  }

  return <div className="rounded border border-border bg-surface-subtle/50 p-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold text-content-primary">Distribuição planejada por capítulo</h3>
        <p className="mt-0.5 text-xs text-content-muted">Arraste a barra (ou use as setas ←/→). A soma precisa dar {total}.</p>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-xs font-medium ${planned === total ? 'text-harmonia-green' : 'text-status-danger-content'}`}>{planned} de {total} questão(ões)</span>
        {!disabled && <button type="button" onClick={onReset} className="rounded border border-border bg-surface px-2.5 py-1 text-xs font-medium text-content-secondary hover:bg-surface-subtle">Restaurar sugestão</button>}
      </div>
    </div>
    <ul className="mt-4 space-y-2">{relevant.map(row)}</ul>
    {others.length > 0 && !disabled && <details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-content-secondary">Outros capítulos do período ({others.length})</summary><ul className="mt-3 space-y-2">{others.map(row)}</ul></details>}
  </div>
}
