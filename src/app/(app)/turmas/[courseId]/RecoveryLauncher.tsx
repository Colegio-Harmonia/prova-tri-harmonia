'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { RecoveryRoundStatus } from '@/db/schema'
import { periodLabel } from '@/lib/recovery/recoveryPlan'
import { ROUND_STATUS_LABELS } from '@/lib/recovery/labels'

type Round = { id: number; subject: string; bimester: number | null; semester: number | null; status: RecoveryRoundStatus; studentCount: number }

// Abre (ou retoma) o lote de recuperação da turma para uma disciplina e um
// período. As disciplinas vêm das provas já vinculadas a esta turma.
export default function RecoveryLauncher({ courseId, classLabel, subjects }: { courseId: string; classLabel: string; subjects: string[] }) {
  const router = useRouter()
  const [subject, setSubject] = useState(subjects[0] ?? '')
  const [period, setPeriod] = useState<string>('1')
  const [rounds, setRounds] = useState<Round[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/recovery?classroomCourseId=${encodeURIComponent(courseId)}`).then((response) => response.ok ? response.json() : { rounds: [] }).then((body) => setRounds(body.rounds ?? [])).catch(() => setRounds([]))
  }, [courseId])

  async function open() {
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/recovery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classroomCourseId: courseId, classLabel, subject, bimester: /^\d$/.test(period) ? Number(period) : null, semester: period.startsWith('s') ? Number(period.slice(1)) : null }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) { setError(body.error ?? 'Não foi possível abrir o lote.'); return }
      router.push(`/recuperacao/${body.round.id}`)
    } finally { setBusy(false) }
  }

  const field = 'mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-content-primary'
  return <section className="rounded-xl border border-border bg-surface">
    <div className="border-b border-border px-5 py-4">
      <h2 className="font-semibold text-content-primary">Prova de recuperação</h2>
      <p className="mt-1 text-sm text-content-secondary">Escolha a disciplina e o período. Na tela seguinte você define a composição (acervo ou IA, total e formato), marca quem ficou de recuperação e confere a matriz por capítulo de cada aluno.</p>
    </div>
    <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-3">
      <label className="text-sm font-medium text-content-primary">Disciplina<select value={subject} onChange={(event) => setSubject(event.target.value)} className={field}>{subjects.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-sm font-medium text-content-primary">Período<select value={period} onChange={(event) => setPeriod(event.target.value)} className={field}>{[1, 2, 3, 4].map((item) => <option key={item} value={item}>{item}º bimestre</option>)}<option value="s1">1º semestre (1º e 2º bim.)</option><option value="s2">2º semestre (3º e 4º bim.)</option><option value="ano">Ano todo</option></select></label>
      <div className="flex items-end"><button type="button" disabled={busy || !subject} onClick={open} className="w-full rounded-md bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-50">{busy ? 'Abrindo…' : 'Abrir lote'}</button></div>
    </div>
    {error && <p className="px-5 pb-4 text-sm text-status-danger-content">{error}</p>}
    {rounds.length > 0 && <ul className="divide-y divide-border border-t border-border">{rounds.map((round) => <li key={round.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
      <span className="text-content-primary">{round.subject} · {periodLabel(round.bimester, round.semester)} · {round.studentCount} aluno(s) · <span className="text-content-secondary">{ROUND_STATUS_LABELS[round.status]}</span></span>
      <Link href={`/recuperacao/${round.id}`} className="font-medium text-harmonia-green hover:underline">Abrir →</Link>
    </li>)}</ul>}
  </section>
}
