'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, LoaderCircle, X } from 'lucide-react'

type SkillOption = {
  code: string
  description: string
  context: string[]
  source: string
  dataVersion: string
  unitRowIndex: number
  unitTitle: string
  curriculumSummary: string
}

type JobState = {
  id: number
  status: string
  errorMessage: string | null
  resultExamId: number | null
  items: Array<{ currentStage: string | null; lastError: string | null }>
}

const FLOW = [
  ['gerando_enunciado', 'Criando enunciado'],
  ['decidindo_imagem', 'Decidindo necessidade de imagem'],
  ['gerando_respostas', 'Gerando respostas'],
  ['validando_formato_respostas', 'Conferindo formato'],
  ['produzindo_imagem', 'Preparando imagem'],
  ['validando_respostas', 'Validando questão com Jev'],
  ['salvando_questao', 'Incluindo na prova'],
] as const

export default function AddQuestionModal({ examId, onClose, onAdded }: { examId: number; onClose: () => void; onAdded: () => void }) {
  const [skills, setSkills] = useState<SkillOption[]>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [questionType, setQuestionType] = useState<'objetiva' | 'descritiva'>('objetiva')
  const [jobId, setJobId] = useState<number | null>(null)
  const [job, setJob] = useState<JobState | null>(null)
  const [loadingSkills, setLoadingSkills] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = useMemo(() => skills.find((skill) => `${skill.code}:${skill.unitRowIndex}` === selectedKey) ?? null, [skills, selectedKey])
  const currentStage = job?.items?.[0]?.currentStage ?? null
  const activeIndex = FLOW.findIndex(([stage]) => stage === currentStage)
  const done = job?.status === 'concluido' && job.resultExamId === examId

  useEffect(() => {
    let live = true
    fetch(`/api/exams/${examId}/add-question`)
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? 'Não foi possível carregar as habilidades BNCC.')
        if (live) setSkills(data.skills ?? [])
      })
      .catch((cause) => live && setError(cause instanceof Error ? cause.message : 'Erro ao carregar as habilidades.'))
      .finally(() => live && setLoadingSkills(false))
    return () => { live = false }
  }, [examId])

  useEffect(() => {
    if (!jobId || done || job?.status === 'erro') return
    let live = true
    const poll = async () => {
      try {
        const response = await fetch(`/api/generation-jobs/${jobId}`)
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? 'Falha ao acompanhar a geração.')
        if (!live) return
        setJob(data)
        if (data.status === 'concluido' && data.resultExamId === examId) onAdded()
        if (data.status === 'erro') setError(data.items?.[0]?.lastError || data.errorMessage || 'A questão não foi gerada.')
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : 'Falha ao acompanhar a geração.')
      }
    }
    void poll()
    const timer = window.setInterval(poll, 2500)
    return () => { live = false; window.clearInterval(timer) }
  }, [jobId, done, job?.status, examId, onAdded])

  async function startGeneration() {
    if (!selected) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/exams/${examId}/add-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bnccCode: selected.code, unitRowIndex: selected.unitRowIndex, questionType }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível iniciar a geração.')
      setJobId(data.jobId)
      setJob({ id: data.jobId, status: 'pendente', errorMessage: null, resultExamId: null, items: [{ currentStage: 'gerando_enunciado', lastError: null }] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao iniciar a geração.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/65 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !jobId) onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="add-question-title" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl sm:p-6">
        <header className="flex items-start justify-between gap-3">
          <div><h2 id="add-question-title" className="text-lg font-semibold">Adicionar questão</h2><p className="mt-1 text-sm text-content-secondary">Escolha a habilidade BNCC. A questão só entra na prova depois de passar pelas validações.</p></div>
          <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-surface-subtle" aria-label="Fechar"><X size={18}/></button>
        </header>

        {!jobId ? <>
          {loadingSkills ? <p className="mt-5 text-sm text-content-secondary">Carregando as habilidades do planejamento…</p> : skills.length ? <>
            <label className="mt-5 block text-sm font-medium" htmlFor="add-question-bncc">Habilidade BNCC</label>
            <select id="add-question-bncc" value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm">
              <option value="">Selecione uma habilidade</option>
              {skills.map((skill) => <option key={`${skill.code}:${skill.unitRowIndex}`} value={`${skill.code}:${skill.unitRowIndex}`}>{skill.code} · {skill.unitTitle}</option>)}
            </select>
            {selected && <article className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 p-4 text-sm">
              <p className="font-semibold text-sky-950">{selected.code} — {selected.description}</p>
              {selected.context.length > 0 && <p className="mt-2 text-xs text-sky-900"><span className="font-semibold">Unidade, eixo e objeto de conhecimento:</span> {selected.context.join(' · ')}</p>}
              <p className="mt-2 text-xs text-sky-900"><span className="font-semibold">Capítulo do planejamento:</span> {selected.unitTitle}</p>
              {selected.curriculumSummary && <p className="mt-1 text-xs text-sky-900"><span className="font-semibold">Conteúdo relacionado:</span> {selected.curriculumSummary}</p>}
              <p className="mt-2 text-[10px] text-sky-800">Fonte BNCC: {selected.source || 'base oficial local'} · versão {selected.dataVersion}</p>
            </article>}
            <label className="mt-4 block text-sm font-medium" htmlFor="add-question-type">Tipo de questão</label>
            <select id="add-question-type" value={questionType} onChange={(event) => setQuestionType(event.target.value as 'objetiva' | 'descritiva')} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm">
              <option value="objetiva">Objetiva</option><option value="descritiva">Discursiva</option>
            </select>
          </> : <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">O planejamento aprovado desta prova não tem habilidades BNCC oficiais disponíveis para seleção.</div>}
          {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">Cancelar</button>
            <button type="button" onClick={startGeneration} disabled={!selected || submitting || loadingSkills} className="rounded-lg bg-harmonia-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitting ? 'Iniciando…' : 'Gerar questão'}</button>
          </div>
        </> : <div className="mt-5">
          {done ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"><div className="flex items-center gap-2 font-semibold"><CheckCircle2 size={19}/> Questão adicionada à prova</div><p className="mt-1 text-sm">A questão foi salva e está disponível para revisão.</p><button type="button" onClick={onClose} className="mt-3 rounded-lg bg-harmonia-green px-4 py-2 text-sm font-semibold text-white">Voltar à prova</button></div>
            : job?.status === 'erro' ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-900"><div className="flex items-center gap-2 font-semibold"><AlertCircle size={18}/> A questão não foi adicionada</div><p className="mt-2 text-sm">{error ?? job.items?.[0]?.lastError ?? job.errorMessage}</p><button type="button" onClick={() => { setJobId(null); setJob(null); setError(null) }} className="mt-3 rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold">Tentar novamente</button></div>
              : <><div className="flex items-center gap-2 text-sm font-semibold text-sky-900"><LoaderCircle size={18} className="animate-spin"/> Gerando questão…</div><ol className="mt-4 grid gap-2 sm:grid-cols-2">{FLOW.map(([stage, label], index) => {
                const completed = activeIndex >= 0 && index < activeIndex
                const active = stage === currentStage
                return <li key={stage} className={`rounded-lg border p-3 text-xs ${completed ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : active ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-border bg-surface-subtle text-content-muted'}`}><span className="font-semibold">{completed ? 'Concluída' : active ? 'Em andamento' : 'Aguardando'}</span><span className="ml-2">{label}</span></li>
              })}</ol><p className="mt-3 text-xs text-content-muted">A questão será anexada somente após a aprovação do Jev.</p></>}
        </div>}
      </section>
    </div>
  )
}
