'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, BadgeCheck, Check, Circle, FileText, LoaderCircle, ShieldCheck, Sparkles, X } from 'lucide-react'

// Aba "Histórico e Fila de Provas" (Subtarefa 1b) — acompanha os jobs de
// geração em segundo plano. Polling de 5s enquanto houver job ativo
// (pendente/gerando); parado quando a fila está quieta (botão Atualizar
// cobre o caso raro de outro dispositivo enfileirar nesse meio-tempo).

type JobRow = {
  id: number
  batchId: number | null
  jobType: string
  generationEngine?: string | null
  examId: number | null
  questionNumber: number | null
  bnccCode: string | null
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
  availableAt?: string | null
  items?: Array<{ slotNumber: number; status: string; currentStage: string | null; lastError?: string | null; diagnostics?: Array<{ code: string | null; message: string | null; resolutionCheck: string | null }>; hasQuestionPayload?: boolean; requiresVisual?: boolean | null }>
}

const GENERATION_STAGE_LABELS: Record<string, string> = {
  aguardando_busca_acervo: 'aguardando busca no acervo',
  buscando_acervo: 'buscando questão no acervo',
  acervo_importado: 'questão importada; aguardando classificação',
  classificando_bloom: 'classificando Bloom com Jev',
  gerando_enunciado: 'criando enunciado com IA',
  decidindo_imagem: 'decidindo necessidade de imagem',
  gerando_respostas: 'gerando respostas',
  validando_formato_respostas: 'conferindo respostas por código',
  produzindo_imagem: 'produzindo imagem da questão',
  validando_respostas: 'validando respostas com Jev',
  reparando_respostas: 'ajustando respostas após validação',
  aguardando_validacao_final: 'aguardando validação das respostas com Jev',
  visual_nao_necessario: 'imagem não necessária',
  gerando_prova_completa: 'gerando prova completa',
  revisando_coerencia_visual: 'revisando enunciados e imagens da prova',
  classificando_dificuldade: 'classificando dificuldade da prova',
}

function currentQuestionStages(job: JobRow) {
  if (job.status !== 'gerando') return []
  return (job.items ?? []).filter((item) => item.currentStage && !['aguardando_busca_acervo', 'acervo_importado'].includes(item.currentStage)).slice(0, 4)
}

function isDeferred(job: JobRow) {
  return job.status === 'pendente' && Boolean(job.availableAt && new Date(job.availableAt).getTime() > Date.now())
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

function displayedJobStatus(job: JobRow) {
  if (isDeferred(job)) return 'Retomada programada'
  if (job.status === 'concluido' && job.items?.some((item) => item.status === 'erro')) return 'Parcial'
  return JOB_STATUS_LABELS[job.status] ?? job.status
}

function displayedJobStatusColor(job: JobRow) {
  if (isDeferred(job)) return 'bg-amber-50 text-amber-800'
  if (job.status === 'concluido' && job.items?.some((item) => item.status === 'erro')) return 'bg-amber-50 text-amber-800'
  return JOB_STATUS_COLORS[job.status] ?? 'bg-neutral-100 text-neutral-600'
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

function formatElapsed(start: string | null, end: string | null, now = Date.now()): string | null {
  if (!start) return null
  const totalSeconds = Math.max(0, Math.floor(((end ? new Date(end).getTime() : now) - new Date(start).getTime()) / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds ? `${minutes}min ${seconds}s` : `${minutes}min`
}

function hasQuestionProgress(job: JobRow) {
  return job.jobType === 'gerar_prova' || job.jobType === 'gerar_atividade' || job.jobType === 'adicionar_questao' || job.jobType === 'adaptar_prova'
}

function isWholeExamGeneration(job: JobRow) {
  return job.generationEngine === 'whole-exam-v1'
    || job.items?.some((item) => item.currentStage === 'classificando_bloom' || item.currentStage === 'buscando_acervo' || item.currentStage === 'gerando_prova_completa' || item.currentStage === 'classificando_dificuldade') === true
}

function jobTitle(job: JobRow) {
  if (job.jobType === 'adicionar_questao') return `Questão adicional${job.examId ? ` · prova #${job.examId}` : ''}`
  if (job.jobType === 'gerar_imagens_prova') return `Imagens da prova${job.examId ? ` #${job.examId}` : ''}`
  return job.subject ?? job.jobType
}

function itemTitle(job: JobRow, slotNumber: number) {
  return `Questão ${job.jobType === 'adicionar_questao' ? job.questionNumber ?? slotNumber : slotNumber}`
}

function JobActions({ job, busy, onCancel, onRetry, onRepeat, singularLabel }: { job: JobRow; busy: boolean; onCancel: (id: number) => void; onRetry: (id: number) => void; onRepeat: (id: number) => void; singularLabel: string }) {
  if (job.jobType === 'gerar_imagens_prova' && job.examId) {
    return <Link href={`/gerar/${job.examId}/revisar`} className="text-xs font-medium text-harmonia-green underline">Abrir prova</Link>
  }
  if (job.status === 'concluido' && job.resultExamId) {
    return (
      <span className="flex flex-wrap items-center gap-3">
        <Link href={`/gerar/${job.resultExamId}/revisar`} className="text-xs font-medium text-harmonia-green underline">Revisar {singularLabel}</Link>
        {job.jobType === 'gerar_prova' && job.items?.some((item) => item.status === 'erro') && <button onClick={() => onRetry(job.id)} disabled={busy} className="text-xs font-medium text-amber-800 underline disabled:opacity-50">Retomar pendentes</button>}
        {job.jobType === 'gerar_prova' && <button onClick={() => onRepeat(job.id)} disabled={busy} className="text-xs font-medium text-content-secondary underline disabled:opacity-50">Gerar novamente</button>}
      </span>
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
    if (job.jobType === 'adicionar_questao') {
      return <span className="text-xs text-red-700">{job.examId ? <Link href={`/gerar/${job.examId}/revisar`} className="font-medium underline">Abrir prova para tentar novamente</Link> : 'Falha ao gerar a questão'}</span>
    }
    return (
      <span className="flex flex-wrap items-center gap-3">
        <button onClick={() => onRetry(job.id)} disabled={busy} className="text-xs font-medium text-harmonia-green underline disabled:opacity-50">Retomar</button>
        {job.jobType === 'gerar_prova' && <button onClick={() => onRepeat(job.id)} disabled={busy} className="text-xs font-medium text-content-secondary underline disabled:opacity-50">Gerar novamente</button>}
      </span>
    )
  }
  return <span className="text-xs text-content-muted">—</span>
}

const QUESTION_FLOW_STEPS = [
  { label: 'Criando enunciado', icon: FileText },
  { label: 'Decidindo necessidade de imagem', icon: Sparkles },
  { label: 'Gerando respostas', icon: Sparkles },
  { label: 'Conferindo respostas por código', icon: Check },
  { label: 'Produzindo imagem', icon: FileText },
  { label: 'Validando respostas com Jev', icon: ShieldCheck },
  { label: 'Gerada', icon: BadgeCheck },
] as const

type FlowStepState = 'complete' | 'active' | 'pending' | 'error' | 'not_applicable'

function activeFlowStep(stage: string | null): number | null {
  if (stage === 'gerando_enunciado') return 0
  if (stage === 'decidindo_imagem') return 1
  if (stage === 'gerando_respostas' || stage === 'reparando_respostas') return 2
  if (stage === 'validando_formato_respostas') return 3
  if (stage === 'produzindo_imagem' || stage === 'visual_nao_necessario') return 4
  if (stage === 'validando_respostas' || stage === 'aguardando_validacao_final') return 5
  return null
}

function questionStepState(item: NonNullable<JobRow['items']>[number], index: number): FlowStepState {
  if (item.status === 'concluido') return 'complete'
  if ((index === 2 || index === 5) && item.requiresVisual === false) return 'not_applicable'
  const awaitingFinalAudit = item.status === 'gerando'
    && item.hasQuestionPayload
    && (!item.currentStage || item.currentStage === 'aguardando_validacao_final')
  if (awaitingFinalAudit) return index < 6 ? 'complete' : 'pending'
  // O Jev já auditou esta versão antes do reparo. A versão reparada ainda está
  // em edição e não deve aparecer como aprovada nem como uma nova auditoria.
  if (item.currentStage === 'reparando_respostas' && index === 6) return 'complete'
  const active = activeFlowStep(item.currentStage)
  if (item.status === 'erro') {
    if (active === null) return 'pending'
    if (index < active) return 'complete'
    if (index === active) return 'error'
    return 'pending'
  }
  if (item.status === 'gerando') {
    const current = active ?? 0
    if (index < current) return 'complete'
    if (index === current) return 'active'
  }
  return 'pending'
}

function FlowStep({ item, index }: { item: NonNullable<JobRow['items']>[number]; index: number }) {
  const state = questionStepState(item, index)
  const step = QUESTION_FLOW_STEPS[index]
  const label = item.currentStage === 'reparando_respostas' && index === 6 ? 'Jev validou versão anterior' : step.label
  const StepIcon = step.icon
  const colors: Record<FlowStepState, string> = {
    complete: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    active: 'border-sky-300 bg-sky-50 text-sky-700 ring-2 ring-sky-100',
    pending: 'border-slate-200 bg-slate-50 text-slate-400',
    error: 'border-rose-200 bg-rose-50 text-rose-700 ring-2 ring-rose-100',
    not_applicable: 'border-violet-200 bg-violet-50 text-violet-700',
  }
  const stateLabel = state === 'complete' ? 'Concluída' : state === 'active' ? 'Em andamento' : state === 'error' ? 'Interrompida' : state === 'not_applicable' ? 'Não necessária' : 'Aguardando'

  return (
    <div role="group" className={`min-w-0 rounded-xl border p-3 transition-colors ${colors[state]}`} aria-label={`${label}: ${stateLabel}`}>
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/80">
          {state === 'complete' ? <Check size={17} strokeWidth={2.5} />
            : state === 'active' ? <LoaderCircle size={17} className="animate-spin" />
              : state === 'error' ? <AlertCircle size={17} />
                : state === 'not_applicable' ? <Circle size={17} />
                : <StepIcon size={17} />}
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold leading-4">{label}</span>
          <span className="mt-0.5 block text-[10px] opacity-80">{stateLabel}</span>
        </span>
      </div>
    </div>
  )
}

function QuestionProgressModal({ job, onClose }: { job: JobRow; onClose: () => void }) {
  const isAdditionalQuestion = job.jobType === 'adicionar_questao'
  const isWholeExam = isWholeExamGeneration(job)
  const dialogRef = useRef<HTMLElement>(null)
  const items = [...(job.items ?? [])].sort((a, b) => a.slotNumber - b.slotNumber)
  const contentReady = items.filter((item) => item.hasQuestionPayload).length
  const completed = items.filter((item) => item.status === 'concluido').length
  const progress = items.length ? Math.round((completed / items.length) * 100) : 0

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const initialFocus = dialogRef.current?.querySelector<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')
    if (initialFocus) initialFocus.focus()
    else dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="generation-progress-title" className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/60 bg-surface-raised shadow-2xl outline-none">
        <header className="relative overflow-hidden border-b border-border bg-gradient-to-br from-emerald-50 via-white to-sky-50 px-5 py-5 sm:px-7">
          <div className="absolute -right-12 -top-16 h-48 w-48 rounded-full bg-sky-200/30 blur-3xl" aria-hidden="true" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-emerald-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Acompanhamento transparente</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${displayedJobStatusColor(job)}`}>{displayedJobStatus(job)}</span>
              </div>
              <h2 id="generation-progress-title" className="mt-3 truncate text-xl font-bold text-content-primary sm:text-2xl">{jobTitle(job)}</h2>
              <p className="mt-1 text-sm text-content-secondary">
                {[job.gradeYear ? `${job.gradeYear}º ano` : null, job.classLabel, job.bimester ? `${job.bimester}º bimestre` : null, job.segment ? SEGMENT_SHORT_LABELS[job.segment] ?? job.segment : null].filter(Boolean).join(' · ')}
                {job.batchId ? ` · lote #${job.batchId}` : ''}
                {job.bnccCode ? ` · ${job.bnccCode}` : ''}
              </p>
            </div>
            <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white bg-white/80 text-content-secondary shadow-sm transition hover:bg-white hover:text-content-primary" aria-label="Fechar acompanhamento"><X size={19}/></button>
          </div>
          <div className="relative mt-5 rounded-xl border border-white bg-white/75 p-3 shadow-sm sm:flex sm:items-center sm:gap-4 sm:px-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-content-primary">{isAdditionalQuestion ? 'Questão concluída' : 'Questões concluídas'}</span>
              <span className="font-bold tabular-nums text-emerald-700">{completed}<span className="font-medium text-content-muted"> / {items.length || '—'}</span></span>
            </div>
            <div className="mt-2 h-2 flex-1 overflow-hidden rounded-full bg-slate-100 sm:mt-0" role="progressbar" aria-label="Progresso da geração" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
            <span className="mt-1 block text-right text-[11px] font-medium text-content-muted sm:mt-0 sm:w-10">{items.length ? `${progress}%` : '—'}</span>
          </div>
          <p className="relative mt-2 text-right text-[10px] text-content-muted">{isWholeExam ? `Geração em lote · ${completed}/${items.length} questões salvas` : isAdditionalQuestion ? `Etapas concluídas: ${completed}/${items.length}` : `Respostas produzidas: ${contentReady}/${items.length} · aprovadas pelo Jev: ${completed}/${items.length}`}</p>
          {isDeferred(job) && <p className="relative mt-2 text-right text-xs font-medium text-amber-800">Nova tentativa programada para {formatDateTime(job.availableAt ?? null)}.</p>}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 p-4 sm:p-6">
          {job.status === 'concluido' && items.some((item) => item.status === 'erro') && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <div><p className="font-semibold">Rascunho parcial salvo</p><p className="mt-1 leading-5">As questões concluídas foram preservadas. Corrija ou aceite a quantidade reduzida na revisão da prova.</p></div>
            </div>
          )}
          {(job.status === 'erro' || isDeferred(job)) && job.errorMessage && (
            <div className={`mb-4 flex items-start gap-3 rounded-xl border p-4 text-sm ${isDeferred(job) ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <div><p className="font-semibold">{isDeferred(job) ? 'Aguardando nova tentativa' : 'A geração foi interrompida'}</p><p className="mt-1 leading-5">{job.errorMessage}</p></div>
            </div>
          )}
          {isWholeExam ? (
            <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                  {job.status === 'gerando' ? <LoaderCircle size={20} className="animate-spin" /> : job.status === 'erro' ? <AlertCircle size={20} /> : <FileText size={20} />}
                </span>
                <div>
                  <h3 className="font-semibold text-content-primary">{job.status === 'concluido' ? 'Prova gerada e salva' : job.status === 'erro' ? 'Geração da prova interrompida' : job.status === 'pendente' ? 'Aguardando nova tentativa' : GENERATION_STAGE_LABELS[items.find((item) => ['classificando_dificuldade', 'revisando_coerencia_visual', 'gerando_prova_completa', 'buscando_acervo', 'classificando_bloom'].includes(item.currentStage ?? ''))?.currentStage ?? ''] ?? 'Gerando prova completa'}</h3>
                  <p className="mt-1 text-sm leading-5 text-content-secondary">Todas as questões são compostas juntas a partir do blueprint da prova. Depois, o sistema revisa os enunciados e as imagens, e o Jev classifica a dificuldade para a distribuição dos pesos percentuais.</p>
                  {items.length > 0 && <p className="mt-2 text-xs text-content-muted">{completed} de {items.length} posições concluídas.</p>}
                  {job.status === 'concluido' && job.resultExamId && <Link href={`/gerar/${job.resultExamId}/revisar`} className="mt-3 inline-block text-sm font-medium text-harmonia-green underline">Revisar prova →</Link>}
                </div>
              </div>
            </section>
          ) : items.length ? (
            <div className="space-y-3">
              {items.map((item) => (
                <article key={item.slotNumber} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-content-primary">{itemTitle(job, item.slotNumber)}</h3>
                    {item.status === 'erro' ? <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-700">Erro nesta questão</span>
                      : item.status === 'concluido' ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">Pronta</span>
                        : item.status === 'gerando' ? <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold text-sky-800">{item.hasQuestionPayload && (!item.currentStage || item.currentStage === 'aguardando_validacao_final') ? 'Respostas prontas; aguardando validação Jev' : GENERATION_STAGE_LABELS[item.currentStage ?? ''] ?? 'iniciando'}</span>
                          : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">Na fila</span>}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {QUESTION_FLOW_STEPS.map((step, index) => <FlowStep key={`${item.slotNumber}-${step.label}-${index}`} item={item} index={index} />)}
                  </div>
                  {item.status === 'erro' && <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                    <p className="font-semibold">Falhou em: {GENERATION_STAGE_LABELS[item.currentStage ?? ''] ?? 'etapa inicial da questão'}</p>
                    <p className="mt-1 whitespace-pre-wrap">{item.lastError || item.diagnostics?.find((diagnostic) => diagnostic.message)?.message || 'O motivo não foi gravado nesta execução.'}</p>
                    {item.diagnostics?.some((diagnostic) => diagnostic.resolutionCheck) && <details className="mt-2 text-xs"><summary className="cursor-pointer font-medium">Orientação para a correção</summary><ul className="mt-1 list-inside list-disc space-y-1">{item.diagnostics.filter((diagnostic) => diagnostic.resolutionCheck).map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}>{diagnostic.resolutionCheck}</li>)}</ul></details>}
                  </div>}
                </article>
              ))}
            </div>
          ) : (
            <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
              <div><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-sky-50 text-sky-700"><LoaderCircle size={24} className={job.status === 'pendente' || job.status === 'gerando' ? 'animate-spin' : ''}/></span><p className="mt-3 font-semibold text-content-primary">{job.status === 'pendente' ? 'Aguardando início' : 'Preparando as questões'}</p><p className="mt-1 max-w-md text-sm text-content-secondary">{isAdditionalQuestion ? 'A questão adicional aparecerá aqui assim que o processamento iniciar.' : 'As etapas por questão aparecerão aqui assim que o processamento preparar os itens da prova.'}</p></div>
            </div>
          )}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white px-5 py-3 text-xs text-content-muted sm:px-7">
          <span>{ACTIVE_STATUSES.includes(job.status) ? `Atualiza automaticamente a cada ${POLL_MS / 1000} segundos.` : `Solicitada em ${formatDateTime(job.createdAt)}.`}</span>
          <button type="button" onClick={onClose} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white transition hover:bg-slate-700">Fechar</button>
        </footer>
      </section>
    </div>
  )
}

export default function QueueList({ isSuperuser, jobTypes, collectionLabel, singularLabel, emptyHref }: { isSuperuser: boolean; jobTypes: readonly string[]; collectionLabel: string; singularLabel: string; emptyHref: string }) {
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [serverNow, setServerNow] = useState<number | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actioningId, setActioningId] = useState<number | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null
  const closeProgress = useCallback(() => setSelectedJobId(null), [])

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
      const responseTime = Date.parse(data.serverTime)
      if (Number.isFinite(responseTime)) setServerNow(responseTime)
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

  async function patchJob(jobId: number, action: 'cancelar' | 'reenfileirar' | 'retomar_pendentes' | 'repetir') {
    setActioningId(jobId)
    try {
      const res = await fetch(`/api/generation-jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) setError(data.error ?? 'Erro ao atualizar o job.')
      else {
        setError(null)
        setNotice(action === 'repetir' ? 'Nova prova adicionada à fila com a mesma configuração.' : action === 'retomar_pendentes' ? 'As questões pendentes voltaram para a fila; as aprovadas serão reaproveitadas.' : null)
      }
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
      {notice && <p role="status" className="text-sm text-harmonia-green">{notice}</p>}
      {loading && <p role="status" aria-live="polite" className="text-sm text-neutral-500">Carregando…</p>}
      {!loading && !error && !jobs.length && (
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
                      {hasQuestionProgress(job) ? <button type="button" onClick={() => setSelectedJobId(job.id)} className="group text-left">
                        <span className="font-semibold text-content-primary group-hover:text-harmonia-green group-hover:underline">{jobTitle(job)}</span>
                        <span className="mt-0.5 block text-[10px] font-medium text-harmonia-green/80">Ver andamento das questões →</span>
                      </button> : <span className="font-medium">{jobTitle(job)}</span>}
                      <p className="mt-1 text-xs text-content-muted">
                        {job.segment ? SEGMENT_SHORT_LABELS[job.segment] ?? job.segment : ''}
                        {job.bimester ? ` · ${job.bimester}º bim.` : ''}
                        {job.batchId ? ` · lote #${job.batchId}` : ''}
                      </p>
                      {(job.status === 'erro' || isDeferred(job)) && job.errorMessage && (
                        <p className={`mt-1 max-w-md truncate text-xs ${isDeferred(job) ? 'text-amber-800' : 'text-red-600'}`} title={job.errorMessage}>{job.errorMessage}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-content-secondary">{job.gradeYear ? `${job.gradeYear}º ano` : '—'}</td>
                    <td className="px-4 py-3 text-content-secondary">{job.classLabel ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${displayedJobStatusColor(job)}`}>
                        {displayedJobStatus(job)}
                      </span>
                      {currentQuestionStages(job).map((item) => (
                        <p key={item.slotNumber} className="mt-1 text-[11px] text-content-muted">
                          Questão {item.slotNumber}: {GENERATION_STAGE_LABELS[item.currentStage ?? ''] ?? item.currentStage}
                        </p>
                      ))}
                      {isDeferred(job) && <p className="mt-1 text-[11px] text-amber-800">Nova tentativa: {formatDateTime(job.availableAt ?? null)}</p>}
                      {job.startedAt && <p className="mt-1 text-[11px] text-content-muted">Fila {formatElapsed(job.createdAt, job.startedAt)} · geração {formatElapsed(job.startedAt, job.finishedAt, serverNow)}</p>}
                      {(job.status === 'erro' || job.attempts > 1) && (
                        <p className="mt-1 text-[11px] text-content-muted" title="Este contador mostra execuções do job. A geração ou o reparo de cada questão podem realizar tentativas internas adicionais.">execução do job {job.attempts}/{job.maxAttempts}</p>
                      )}
                    </td>
                    {isSuperuser && <td className="px-4 py-3 text-content-secondary">{job.requesterName}</td>}
                    <td className="whitespace-nowrap px-4 py-3 text-content-secondary">{formatDateTime(job.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <JobActions job={job} busy={actioningId === job.id} onCancel={(id) => patchJob(id, 'cancelar')} onRetry={(id) => patchJob(id, job.status === 'concluido' ? 'retomar_pendentes' : 'reenfileirar')} onRepeat={(id) => patchJob(id, 'repetir')} singularLabel={singularLabel} />
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
                    {hasQuestionProgress(job) ? <button type="button" onClick={() => setSelectedJobId(job.id)} className="text-left">
                      <span className="font-semibold text-content-primary">{jobTitle(job)}</span>
                      <span className="mt-0.5 block text-[10px] font-medium text-harmonia-green">Ver andamento das questões →</span>
                    </button> : <span className="font-semibold text-content-primary">{jobTitle(job)}</span>}
                    <p className="mt-1 text-xs text-content-muted">
                      {job.gradeYear ? `${job.gradeYear}º ano` : ''}
                      {job.classLabel ? ` · ${job.classLabel}` : ''}
                      {job.bimester ? ` · ${job.bimester}º bim.` : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${displayedJobStatusColor(job)}`}>
                    {displayedJobStatus(job)}
                  </span>
                </div>
                {(job.status === 'erro' || isDeferred(job)) && job.errorMessage && (
                  <p className={`mt-2 text-xs ${isDeferred(job) ? 'text-amber-800' : 'text-red-600'}`}>{job.errorMessage}</p>
                )}
                {isDeferred(job) && <p className="mt-2 text-xs font-medium text-amber-800">Nova tentativa: {formatDateTime(job.availableAt ?? null)}</p>}
                {currentQuestionStages(job).map((item) => (
                  <p key={item.slotNumber} className="mt-2 text-xs text-content-muted">
                    Questão {item.slotNumber}: {GENERATION_STAGE_LABELS[item.currentStage ?? ''] ?? item.currentStage}
                  </p>
                ))}
                <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs text-content-muted">
                  <span>{isSuperuser ? `${job.requesterName} · ` : ''}{formatDateTime(job.createdAt)}{job.startedAt && <span className="block pt-1">Fila {formatElapsed(job.createdAt, job.startedAt)} · geração {formatElapsed(job.startedAt, job.finishedAt, serverNow)}</span>}</span>
                  <JobActions job={job} busy={actioningId === job.id} onCancel={(id) => patchJob(id, 'cancelar')} onRetry={(id) => patchJob(id, job.status === 'concluido' ? 'retomar_pendentes' : 'reenfileirar')} onRepeat={(id) => patchJob(id, 'repetir')} singularLabel={singularLabel} />
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {selectedJob && <QuestionProgressModal job={selectedJob} onClose={closeProgress} />}
    </div>
  )
}
