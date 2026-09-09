'use client'

import Link from 'next/link'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

// Observador global da fila de geração (Subtarefa 1b): um único poller por
// aba do navegador, montado no layout de (app). Fornece a contagem de jobs
// ativos pro badge do menu e dispara toasts quando um job termina
// (transição pendente/gerando → concluido/erro detectada entre polls).
// Ritmo adaptativo: 5s com job ativo, 30s parado — a carga fica trivial.

type JobSnapshot = {
  id: number
  jobType: string
  status: string
  subject: string | null
  gradeYear: number | null
  classLabel: string | null
  resultExamId: number | null
}

type ToastItem = {
  key: number
  kind: 'ok' | 'err'
  text: string
  href: string
}

const ACTIVE_STATUSES = ['pendente', 'gerando']
const ACTIVE_POLL_MS = 5_000
const IDLE_POLL_MS = 30_000
const TOAST_DISMISS_MS = 10_000

const GenerationJobsContext = createContext({ activeCount: 0, activeProofCount: 0, activeActivityCount: 0, activeReinforcementCount: 0 })

export function useGenerationJobs() {
  return useContext(GenerationJobsContext)
}

function jobLabel(job: JobSnapshot): string {
  const fallback = job.jobType === 'gerar_reforco_enem' ? 'Reforço ENEM' : job.jobType === 'gerar_atividade' ? 'Atividade' : 'Prova'
  const base = `${job.subject ?? fallback}${job.gradeYear ? ` — ${job.gradeYear}º ano` : ''}`
  return job.classLabel ? `${base} (${job.classLabel})` : base
}

function isActivityJob(job: JobSnapshot) {
  return job.jobType === 'gerar_atividade'
}
function isReinforcementJob(job: JobSnapshot) {
  return job.jobType === 'gerar_reforco_enem'
}

export function GenerationJobsProvider({ children }: { children: React.ReactNode }) {
  const [activeCount, setActiveCount] = useState(0)
  const [activeProofCount, setActiveProofCount] = useState(0)
  const [activeActivityCount, setActiveActivityCount] = useState(0)
  const [activeReinforcementCount, setActiveReinforcementCount] = useState(0)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  // Status visto por job no poll anterior — base da detecção de transição.
  const prevStatuses = useRef<Map<number, string>>(new Map())
  const toastKey = useRef(0)

  const dismissToast = useCallback((key: number) => {
    setToasts((prev) => prev.filter((t) => t.key !== key))
  }, [])

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/generation-jobs?limit=50')
      if (!res.ok) return
      const data = await res.json()
      const jobs: JobSnapshot[] = data.jobs ?? []

      const newToasts: ToastItem[] = []
      for (const job of jobs) {
        const prev = prevStatuses.current.get(job.id)
        const finishedNow = prev !== undefined && ACTIVE_STATUSES.includes(prev) && (job.status === 'concluido' || job.status === 'erro')
        if (finishedNow) {
          const activity = isActivityJob(job)
          const reinforcement = isReinforcementJob(job)
          const collectionHref = activity ? '/atividades?modo=acompanhar&aba=fila' : reinforcement ? '/reforco?modo=acompanhar&aba=fila' : '/status?aba=fila'
          toastKey.current += 1
          newToasts.push(
            job.status === 'concluido'
              ? {
                  key: toastKey.current,
                  kind: 'ok',
                  text: `${activity ? 'Atividade' : reinforcement ? 'Reforço ENEM' : 'Prova'} pronto para revisão: ${jobLabel(job)}`,
                  href: job.resultExamId ? `/gerar/${job.resultExamId}/revisar` : collectionHref,
                }
              : {
                  key: toastKey.current,
                  kind: 'err',
                  text: `Falha na geração d${activity ? 'a atividade' : reinforcement ? 'o reforço ENEM' : 'a prova'}: ${jobLabel(job)}`,
                  href: collectionHref,
                },
          )
        }
      }

      prevStatuses.current = new Map(jobs.map((j) => [j.id, j.status]))
      const activeJobs = jobs.filter((j) => ACTIVE_STATUSES.includes(j.status))
      setActiveCount(activeJobs.length)
      setActiveActivityCount(activeJobs.filter(isActivityJob).length)
      setActiveReinforcementCount(activeJobs.filter(isReinforcementJob).length)
      setActiveProofCount(activeJobs.filter((job) => !isActivityJob(job) && !isReinforcementJob(job)).length)
      if (newToasts.length) setToasts((prev) => [...prev, ...newToasts])
    } catch {
      // Falha de rede no poll é silenciosa — próxima rodada tenta de novo.
    }
  }, [])

  useEffect(() => {
    poll()
    // O intervalo depende de activeCount pra alternar o ritmo — recriado
    // quando a fila esvazia/enche.
    const interval = setInterval(poll, activeCount > 0 ? ACTIVE_POLL_MS : IDLE_POLL_MS)
    return () => clearInterval(interval)
  }, [poll, activeCount])

  useEffect(() => {
    if (!toasts.length) return
    const timers = toasts.map((t) => setTimeout(() => dismissToast(t.key), TOAST_DISMISS_MS))
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismissToast])

  return (
    <GenerationJobsContext.Provider value={{ activeCount, activeProofCount, activeActivityCount, activeReinforcementCount }}>
      {children}
      {toasts.length > 0 && (
        <div aria-live="polite" className="fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.key}
              className={`flex items-start gap-2 rounded-lg border p-3 shadow-lg ${
                toast.kind === 'ok' ? 'border-harmonia-green/40 bg-surface' : 'border-red-200 bg-surface'
              }`}
            >
              <span aria-hidden="true">{toast.kind === 'ok' ? '🧾' : '⚠️'}</span>
              <div className="flex-1">
                <p className="text-sm text-content-primary">{toast.text}</p>
                <Link
                  href={toast.href}
                  onClick={() => dismissToast(toast.key)}
                  className={`text-xs font-medium underline ${toast.kind === 'ok' ? 'text-harmonia-green' : 'text-red-600'}`}
                >
                  {toast.kind === 'ok' ? 'Revisar agora' : 'Ver na fila'}
                </Link>
              </div>
              <button
                onClick={() => dismissToast(toast.key)}
                aria-label="Fechar aviso"
                className="text-content-muted hover:text-content-primary"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </GenerationJobsContext.Provider>
  )
}
