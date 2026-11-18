'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { RecoveryRoundStatus } from '@/db/schema'
import { periodLabel } from '@/lib/recovery/recoveryPlan'
import { ROUND_STATUS_LABELS, ROUND_STATUS_TONES } from '@/lib/recovery/labels'

type Round = { id: number; classLabel: string; subject: string; gradeYear: number; bimester: number | null; status: RecoveryRoundStatus; studentCount: number; readyCount: number; generatingCount: number; printedAt: string | null }

function StatusPill({ status }: { status: RecoveryRoundStatus }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ROUND_STATUS_TONES[status]}`}>{ROUND_STATUS_LABELS[status]}</span>
}

export default function RecuperacaoHome({ isSuperuser }: { isSuperuser: boolean }) {
  const [tab, setTab] = useState<'lotes' | 'fila'>('lotes')
  const [rounds, setRounds] = useState<Round[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/recovery').then(async (response) => {
      const body = await response.json()
      if (cancelled) return
      if (!response.ok) setError(body.error ?? 'Não foi possível carregar os lotes.')
      else setRounds(body.rounds)
    }).catch(() => !cancelled && setError('Não foi possível carregar os lotes.'))
    return () => { cancelled = true }
  }, [])

  // Fila de impressão: lotes aprovados agrupados por sala, os não impressos primeiro.
  const queue = useMemo(() => {
    const bySala = new Map<string, Round[]>()
    for (const round of rounds ?? []) {
      if (round.status !== 'aprovado' && round.status !== 'impresso') continue
      bySala.set(round.classLabel, [...(bySala.get(round.classLabel) ?? []), round])
    }
    return [...bySala.entries()].map(([sala, items]) => ({ sala, items: items.sort((a, b) => Number(a.status === 'impresso') - Number(b.status === 'impresso') || a.subject.localeCompare(b.subject, 'pt-BR')) }))
      .sort((a, b) => a.sala.localeCompare(b.sala, 'pt-BR'))
  }, [rounds])
  const waiting = (rounds ?? []).filter((round) => round.status === 'em_aprovacao').length
  const pendingPrint = (rounds ?? []).filter((round) => round.status === 'aprovado').length

  if (error) return <p className="rounded border border-status-danger-border bg-status-danger-surface p-4 text-sm text-status-danger-content">{error}</p>
  if (!rounds) return <p className="text-sm text-content-secondary">Carregando…</p>

  return <div className="space-y-5">
    <div role="tablist" className="flex gap-2 border-b border-border">
      {([['lotes', `Lotes${isSuperuser && waiting ? ` · ${waiting} aguardando você` : ''}`], ['fila', `Fila de impressão${pendingPrint ? ` · ${pendingPrint}` : ''}`]] as const).map(([key, label]) =>
        <button key={key} role="tab" aria-selected={tab === key} type="button" onClick={() => setTab(key)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === key ? 'border-harmonia-green text-content-primary' : 'border-transparent text-content-secondary hover:text-content-primary'}`}>{label}</button>)}
    </div>

    {tab === 'lotes' && (rounds.length === 0
      ? <div className="rounded-xl border border-border bg-surface p-6 text-sm text-content-secondary">Nenhum lote ainda. Abra a página da turma em <Link href="/turmas" className="font-medium text-harmonia-green underline">Turmas</Link> e use “Prova de recuperação”.</div>
      : <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {rounds.map((round) => <li key={round.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <p className="font-medium text-content-primary">{round.classLabel} · {round.subject}</p>
            <p className="mt-1 text-xs text-content-muted">{round.gradeYear}º ano · {periodLabel(round.bimester)} · {round.studentCount} aluno(s){round.generatingCount ? ` · ${round.generatingCount} em geração` : ''}</p>
          </div>
          <div className="flex items-center gap-3"><StatusPill status={round.status} /><Link href={`/recuperacao/${round.id}`} className="text-sm font-medium text-harmonia-green hover:underline">Abrir lote →</Link></div>
        </li>)}
      </ul>)}

    {tab === 'fila' && (queue.length === 0
      ? <div className="rounded-xl border border-border bg-surface p-6 text-sm text-content-secondary">Nenhum lote aprovado para impressão.</div>
      : <div className="space-y-4">{queue.map(({ sala, items }) => <section key={sala} className="rounded-xl border border-border bg-surface">
        <h2 className="border-b border-border px-5 py-3 font-semibold text-content-primary">{sala}</h2>
        <ul className="divide-y divide-border">{items.map((round) => <li key={round.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div><p className="font-medium text-content-primary">{round.subject} · {periodLabel(round.bimester)}</p><p className="mt-1 text-xs text-content-muted">{round.readyCount} prova(s) individual(is){round.printedAt ? ` · baixado em ${new Date(round.printedAt).toLocaleDateString('pt-BR')}` : ''}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={round.status} />
            <a href={`/api/recovery/${round.id}/pdf?doc=prova`} className="rounded-md bg-action-primary px-3 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover">Baixar provas (PDF)</a>
            <a href={`/api/recovery/${round.id}/pdf?doc=gabarito`} className="rounded-md border border-border px-3 py-2 text-sm font-medium text-content-primary hover:bg-surface-subtle">Gabaritos (PDF)</a>
          </div>
        </li>)}</ul>
      </section>)}<p className="text-xs text-content-muted">O PDF junta as provas da sala em ordem alfabética, com o nome do aluno no topo de cada página e cada aluno começando numa folha nova (frente e verso). Montar o PDF leva alguns segundos por aluno.</p></div>)}
  </div>
}
