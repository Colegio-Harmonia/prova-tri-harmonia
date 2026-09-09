'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'

// Aba "Histórico e Fila de Provas" (Subtarefa 1b) — acompanha os jobs de
// geração em segundo plano. Polling de 5s enquanto houver job ativo
// (pendente/gerando); parado quando a fila está quieta (botão Atualizar
// cobre o caso raro de outro dispositivo enfileirar nesse meio-tempo).

type JobRow = {
  id: number
  batchId: number | null
  jobType: string
  status: string
  subject: string | null
  segment: string | null
  gradeYear: number | null
  bimester: number | null
  classLabel: string | null
  attempts: number
  maxAttempts: number
  resultExamId: number | null
  errorMessage: string | null
  requestedBy: number
  requesterName: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

const JOB_STATUS_LABELS: Record<string, string> = {
  pendente: 'Pendente',
  gerando: 'Gerando…',
  concluido: 'Concluído',
  erro: 'Erro',
  cancelado: 'Cancelado',
}

const JOB_STATUS_COLORS: Record<string, string> = {
  pendente: 'bg-neutral-100 text-neutral-600',
  gerando: 'bg-amber-50 text-amber-700',
  concluido: 'bg-harmonia-green/10 text-harmonia-green',
  erro: 'bg-red-50 text-red-700',
  cancelado: 'bg-neutral-100 text-neutral-400 line-through',
}

const SEGMENT_SHORT_LABELS: Record<string, string> = {
  'anos-iniciais': 'Anos Iniciais',
  'anos-finais': 'Anos Finais',
  'ensino-medio': 'Ensino Médio',
}

const ACTIVE_STATUSES = ['pendente', 'gerando']
const POLL_MS = 5_000

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function JobActions({ job, busy, onCancel, onRetry, singularLabel }: { job: JobRow; busy: boolean; onCancel: (id: number) => void; onRetry: (id: number) => void; singularLabel: string }) {
  if (job.status === 'concluido' && job.resultExamId) {
    return (
      <Link href={`/gerar/${job.resultExamId}/revisar`} className="text-xs font-medium text-harmonia-green underline">
        Revisar {singularLabel}
      </Link>
    )
  }
  if (job.status === 'pendente') {
    return (
      <button onClick={() => onCancel(job.id)} disabled={busy} className="text-xs font-medium text-red-600 underline disabled:opacity-50">
        Cancelar
      </button>
    )
  }
  if (job.status === 'erro') {
    return (
      <button onClick={() => onRetry(job.id)} disabled={busy} className="text-xs font-medium text-harmonia-green underline disabled:opacity-50">
        Tentar de novo
      </button>
    )
  }
  return <span className="text-xs text-content-muted">—</span>
}

export default function QueueList({ isSuperuser, jobTypes, collectionLabel, singularLabel, emptyHref }: { isSuperuser: boolean; jobTypes: readonly string[]; collectionLabel: string; singularLabel: string; emptyHref: string }) {
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actioningId, setActioningId] = useState<number | null>(null)

  const fetchJobs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '100', jobTypes: jobTypes.join(',') })
      const res = await fetch(`/api/generation-jobs?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao carregar a fila.')
        return
      }
      setError(null)
      setJobs(data.jobs)
    } catch {
      setError('Falha de rede ao carregar a fila.')
    } finally {
      setLoading(false)
    }
  }, [jobTypes])

  const hasActive = useMemo(() => jobs.some((j) => ACTIVE_STATUSES.includes(j.status)), [jobs])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  useEffect(() => {
    if (!hasActive) return
    const interval = setInterval(fetchJobs, POLL_MS)
    return () => clearInterval(interval)
  }, [hasActive, fetchJobs])

  async function patchJob(jobId: number, action: 'cancelar' | 'reenfileirar') {
    setActioningId(jobId)
    try {
      const res = await fetch(`/api/generation-jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Erro ao atualizar o job.')
      else setError(null)
      await fetchJobs()
    } catch {
      setError('Falha de rede ao atualizar o job.')
    } finally {
      setActioningId(null)
    }
  }

  const activeCount = jobs.filter((j) => ACTIVE_STATUSES.includes(j.status)).length

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-content-secondary">
          {activeCount > 0
            ? `${activeCount} geração(ões) de ${collectionLabel} em andamento — atualizando a cada ${POLL_MS / 1000}s.`
            : 'Nenhuma geração em andamento.'}
        </p>
        <button onClick={() => { setLoading(true); fetchJobs() }} className="min-h-10 self-start rounded border border-border px-3 py-1.5 text-xs font-medium sm:self-auto">
          Atualizar
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {loading && <p role="status" aria-live="polite" className="text-sm text-neutral-500">Carregando…</p>}
      {!loading && !jobs.length && (
        <p className="text-sm text-neutral-500">
          Nenhuma geração de {collectionLabel} na fila ainda. Dispare uma em <Link href={emptyHref} className="text-harmonia-green underline">{singularLabel === 'atividade' ? 'Reforço ENEM' : 'Gerar prova'}</Link>.
        </p>
      )}

      {!loading && jobs.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded border border-border bg-surface md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Jobs da fila de geração de {collectionLabel}</caption>
              <thead>
                <tr className="border-b border-border bg-surface-subtle text-xs uppercase tracking-wide text-content-secondary">
                  <th scope="col" className="px-4 py-3 font-medium">Disciplina</th>
                  <th scope="col" className="px-4 py-3 font-medium">Série</th>
                  <th scope="col" className="px-4 py-3 font-medium">Turma</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  {isSuperuser && <th scope="col" className="px-4 py-3 font-medium">Solicitado por</th>}
                  <th scope="col" className="px-4 py-3 font-medium">Pedido em</th>
                  <th scope="col" className="px-4 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-surface-subtle">
                    <td className="px-4 py-3">
                      <span className="font-medium">{job.subject ?? job.jobType}</span>
                      <p className="text-xs text-content-muted">
                        {job.segment ? SEGMENT_SHORT_LABELS[job.segment] ?? job.segment : ''}
                        {job.bimester ? ` · ${job.bimester}º bim.` : ''}
                        {job.batchId ? ` · lote #${job.batchId}` : ''}
                      </p>
                      {job.status === 'erro' && job.errorMessage && (
                        <p className="mt-1 max-w-md truncate text-xs text-red-600" title={job.errorMessage}>{job.errorMessage}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-content-secondary">{job.gradeYear ? `${job.gradeYear}º ano` : '—'}</td>
                    <td className="px-4 py-3 text-content-secondary">{job.classLabel ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${JOB_STATUS_COLORS[job.status] ?? 'bg-neutral-100'}`}>
                        {JOB_STATUS_LABELS[job.status] ?? job.status}
                      </span>
                      {(job.status === 'erro' || job.attempts > 1) && (
                        <p className="mt-1 text-[11px] text-content-muted">tentativa {job.attempts}/{job.maxAttempts}</p>
                      )}
                    </td>
                    {isSuperuser && <td className="px-4 py-3 text-content-secondary">{job.requesterName}</td>}
                    <td className="whitespace-nowrap px-4 py-3 text-content-secondary">{formatDateTime(job.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <JobActions job={job} busy={actioningId === job.id} onCancel={(id) => patchJob(id, 'cancelar')} onRetry={(id) => patchJob(id, 'reenfileirar')} singularLabel={singularLabel} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {jobs.map((job) => (
              <article key={job.id} className="rounded-lg border border-border bg-surface p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="font-semibold text-content-primary">{job.subject ?? job.jobType}</span>
                    <p className="mt-1 text-xs text-content-muted">
                      {job.gradeYear ? `${job.gradeYear}º ano` : ''}
                      {job.classLabel ? ` · ${job.classLabel}` : ''}
                      {job.bimester ? ` · ${job.bimester}º bim.` : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${JOB_STATUS_COLORS[job.status] ?? 'bg-neutral-100'}`}>
                    {JOB_STATUS_LABELS[job.status] ?? job.status}
                  </span>
                </div>
                {job.status === 'erro' && job.errorMessage && (
                  <p className="mt-2 text-xs text-red-600">{job.errorMessage}</p>
                )}
                <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs text-content-muted">
                  <span>{isSuperuser ? `${job.requesterName} · ` : ''}{formatDateTime(job.createdAt)}</span>
                  <JobActions job={job} busy={actioningId === job.id} onCancel={(id) => patchJob(id, 'cancelar')} onRetry={(id) => patchJob(id, 'reenfileirar')} singularLabel={singularLabel} />
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
