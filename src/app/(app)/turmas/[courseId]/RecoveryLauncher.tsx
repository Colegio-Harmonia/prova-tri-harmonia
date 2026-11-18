'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { RecoveryRoundStatus } from '@/db/schema'
import { periodLabel, RECOVERY_RULES } from '@/lib/recovery/recoveryPlan'
import { ROUND_STATUS_LABELS } from '@/lib/recovery/labels'

type Round = { id: number; subject: string; bimester: number | null; status: RecoveryRoundStatus; studentCount: number }

// Abre (ou retoma) o lote de recuperação da turma para uma disciplina e um
// período. As disciplinas vêm das provas já vinculadas a esta turma.
export default function RecoveryLauncher({ courseId, classLabel, subjects }: { courseId: string; classLabel: string; subjects: string[] }) {
  const router = useRouter()
  const [subject, setSubject] = useState(subjects[0] ?? '')
  const [period, setPeriod] = useState<string>('1')
  const [questionCount, setQuestionCount] = useState<number>(RECOVERY_RULES.defaultQuestions)
  const [rounds, setRounds] = useState<Round[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/recovery?classroomCourseId=${encodeURIComponent(courseId)}`).then((response) => response.ok ? response.json() : { rounds: [] }).then((body) => setRounds(body.rounds ?? [])).catch(() => setRounds([]))
  }, [courseId])

  async function open() {
    setBusy(true); setError(null)
    try {
      const response = await fetch('/api/recovery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classroomCourseId: courseId, classLabel, subject, bimester: period === 'ano' ? null : Number(period), questionCount }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) { setError(body.error ?? 'Não foi possível abrir o lote.'); return }
      router.push(`/recuperacao/${body.round.id}`)
    } finally { setBusy(false) }
  }

  const field = 'mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-content-primary'
  return <section className="rounded-xl border border-border bg-surface">
    <div className="border-b border-border px-5 py-4">
      <h2 className="font-semibold text-content-primary">Prova de recuperação</h2>
      <p className="mt-1 text-sm text-content-secondary">Escolha a disciplina e o período. Na tela seguinte você marca quem ficou de recuperação; cada aluno recebe uma prova com as habilidades em que ficou abaixo de 60%.</p>
    </div>
    <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-4">
      <label className="text-sm font-medium text-content-primary">Disciplina<select value={subject} onChange={(event) => setSubject(event.target.value)} className={field}>{subjects.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-sm font-medium text-content-primary">Período<select value={period} onChange={(event) => setPeriod(event.target.value)} className={field}>{[1, 2, 3, 4].map((item) => <option key={item} value={item}>{item}º bimestre</option>)}<option value="ano">Ano todo</option></select></label>
      <label className="text-sm font-medium text-content-primary">Questões por aluno<input type="number" min={RECOVERY_RULES.minQuestions} max={RECOVERY_RULES.maxQuestions} value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} className={field} /></label>
      <div className="flex items-end"><button type="button" disabled={busy || !subject} onClick={open} className="w-full rounded-md bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground hover:bg-action-primary-hover disabled:opacity-50">{busy ? 'Abrindo…' : 'Abrir lote'}</button></div>
    </div>
    {error && <p className="px-5 pb-4 text-sm text-status-danger-content">{error}</p>}
    {rounds.length > 0 && <ul className="divide-y divide-border border-t border-border">{rounds.map((round) => <li key={round.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
      <span className="text-content-primary">{round.subject} · {periodLabel(round.bimester)} · {round.studentCount} aluno(s) · <span className="text-content-secondary">{ROUND_STATUS_LABELS[round.status]}</span></span>
      <Link href={`/recuperacao/${round.id}`} className="font-medium text-harmonia-green hover:underline">Abrir →</Link>
    </li>)}</ul>}
  </section>
}
