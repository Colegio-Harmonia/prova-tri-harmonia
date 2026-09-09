'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ADAPTATION_LIBRARIES } from '@/config/adaptationLibraries'
import type { AdaptationProfileId } from '@/db/schema'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

// Aba "Adaptação de Atividade" (Módulo 4): seleção múltipla de laudos com
// preview das regras das bibliotecas, geração via fila, revisão lado a
// lado (original × adaptada) e aprovação — só então o documento "Prova
// Adaptada" existe. LGPD: o campo de aluno é opcional e fica só no
// sistema; o documento imprime apenas os perfis.

type Exam = {
  id: number
  subject: string
  gradeYear: number
  status: string
  generationPayload: ExamGenerationResult
}

type AdaptedQuestionView = {
  adaptation: {
    adaptedStatement?: string
    adaptationNotes: string
    formulaSupport: string | null
    visualSupportSuggestion: string | null
    imageDescription: string | null
    removedElements: string[]
    harmonizationNotes: string | null
  }
  number: number
  statement: string
  supportText: string | null
  alternatives: Array<{ letter: string; text: string }> | null
}

type Adaptation = {
  id: number
  adaptationProfiles: AdaptationProfileId[]
  libraryVersions: Record<string, string>
  targetStudentLabel: string | null
  status: 'gerando' | 'pronto_revisao' | 'aprovado' | 'erro'
  errorMessage: string | null
  adaptedPayload: { questions: AdaptedQuestionView[] } | null
  provaAdaptadaDocUrl: string | null
  createdAt: string
}

const STATUS_LABELS: Record<Adaptation['status'], string> = {
  gerando: 'Gerando…',
  pronto_revisao: 'Pronta pra revisão',
  aprovado: 'Aprovada',
  erro: 'Erro',
}

const STATUS_COLORS: Record<Adaptation['status'], string> = {
  gerando: 'bg-status-warning/10 text-status-warning',
  pronto_revisao: 'bg-status-info/10 text-status-info',
  aprovado: 'bg-status-success/10 text-status-success',
  erro: 'bg-status-danger/10 text-status-danger',
}

const PROFILE_IDS = Object.keys(ADAPTATION_LIBRARIES) as AdaptationProfileId[]
const inputClassName = 'mt-1 min-h-10 w-full rounded border border-border bg-surface px-3 py-2 text-sm text-content-primary shadow-soft placeholder:text-content-muted transition-colors hover:border-border-strong focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/25'

export default function AdaptarExam({ examId }: { examId: number }) {
  const [exam, setExam] = useState<Exam | null>(null)
  const [adaptations, setAdaptations] = useState<Adaptation[] | null>(null)
  const [selectedProfiles, setSelectedProfiles] = useState<AdaptationProfileId[]>([])
  const [studentLabel, setStudentLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [approvingId, setApprovingId] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    try {
      const [examRes, adaptationsRes] = await Promise.all([
        fetch(`/api/exams/${examId}`).then((r) => r.json()),
        fetch(`/api/exams/${examId}/adaptations`).then((r) => r.json()),
      ])
      if (examRes.error) throw new Error(examRes.error)
      if (adaptationsRes.error) throw new Error(adaptationsRes.error)
      setExam(examRes.exam)
      setAdaptations(adaptationsRes.adaptations)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar dados.')
    }
  }, [examId])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Polling enquanto alguma adaptação está gerando na fila.
  const hasGenerating = (adaptations ?? []).some((a) => a.status === 'gerando')
  useEffect(() => {
    if (!hasGenerating) return
    const interval = setInterval(loadAll, 5000)
    return () => clearInterval(interval)
  }, [hasGenerating, loadAll])

  function toggleProfile(id: AdaptationProfileId) {
    setSelectedProfiles((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  async function createAdaptation() {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch(`/api/exams/${examId}/adaptations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profiles: selectedProfiles,
          ...(studentLabel.trim() ? { targetStudentLabel: studentLabel.trim() } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao enfileirar adaptação.')
      setSelectedProfiles([])
      setStudentLabel('')
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enfileirar adaptação.')
    } finally {
      setCreating(false)
    }
  }

  async function approve(adaptationId: number) {
    setApprovingId(adaptationId)
    setError(null)
    try {
      const res = await fetch(`/api/exams/${examId}/adaptations/${adaptationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'aprovar' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro ao aprovar adaptação.')
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao aprovar adaptação.')
    } finally {
      setApprovingId(null)
    }
  }

  if (error && !exam) return <p className="text-sm text-status-danger">{error}</p>
  if (!exam || !adaptations) return <p className="text-sm text-content-secondary">Carregando…</p>

  const originalByNumber = new Map(exam.generationPayload.questions.map((q) => [q.number, q]))
  const adaptable = ['aprovado', 'impresso', 'aplicado', 'corrigido'].includes(exam.status)

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/gerar/${examId}/revisar`} className="text-sm text-action-primary underline">← Voltar pra revisão da prova</Link>
        <h1 className="mt-2 text-lg font-semibold text-content-primary">Adaptação de Atividade</h1>
        <p className="mt-1 text-sm text-content-secondary">{exam.subject} — {exam.gradeYear}º ano · prova #{exam.id}</p>
      </div>

      {error && <div role="alert" className="rounded border border-status-danger/40 bg-status-danger/10 p-3 text-sm text-status-danger">{error}</div>}

      {!adaptable ? (
        <div className="rounded border border-status-warning/40 bg-status-warning/10 p-4 text-sm text-content-primary">
          A adaptação só fica disponível depois que a prova for revisada e aprovada — a versão adaptada deriva do conteúdo final.
        </div>
      ) : (
        <section aria-labelledby="adaptation-profiles-heading" className="rounded-lg border border-border bg-surface p-5 shadow-soft">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <h2 id="adaptation-profiles-heading" className="text-base font-semibold text-content-primary">Nova adaptação</h2>
            <span className="text-sm font-medium text-content-secondary">Perfis de laudo</span>
          </div>
          <p className="mt-2 text-xs text-content-secondary">
            Seleção múltipla (ex: TEA + TDAH). As regras das bibliotecas selecionadas são mescladas de forma determinística; a prova original nunca é alterada.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {PROFILE_IDS.map((id) => {
              const library = ADAPTATION_LIBRARIES[id]
              const checked = selectedProfiles.includes(id)
              return (
                <label key={id} className={`cursor-pointer rounded-lg border p-3 text-sm transition-colors ${checked ? 'border-action-primary bg-action-primary/10' : 'border-border bg-surface-raised hover:border-border-strong'}`}>
                  <span className="flex items-center gap-2 font-medium text-content-primary">
                    <input className="h-4 w-4 accent-action-primary" type="checkbox" checked={checked} onChange={() => toggleProfile(id)} />
                    {library.label}
                    <span className="text-xs font-normal text-content-muted">v{library.version}</span>
                  </span>
                  <ul className="mt-2 list-disc pl-6 text-xs text-content-secondary">
                    {library.contentDirectives.slice(0, 2).map((d, i) => (
                      <li key={i}>{d.length > 110 ? `${d.slice(0, 110)}…` : d}</li>
                    ))}
                    {Object.entries(library.layoutRules).length > 0 && (
                      <li className="text-content-muted">
                        Diagramação: {[
                          library.layoutRules.minFontPt ? `fonte ≥${library.layoutRules.minFontPt}pt` : null,
                          library.layoutRules.lineSpacing ? `espaçamento ${library.layoutRules.lineSpacing}` : null,
                          library.layoutRules.boldCommandKeywords ? 'negrito em palavras-chave' : null,
                          library.layoutRules.extraAnswerSpace ? 'espaço ampliado de cálculo' : null,
                          library.layoutRules.formulaSupportHeader ? 'apoio de fórmulas' : null,
                          library.layoutRules.highContrast ? 'alto contraste' : null,
                        ].filter(Boolean).join(', ')}
                      </li>
                    )}
                  </ul>
                </label>
              )
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="student-label" className="text-sm font-medium text-content-primary">Aluno/identificação (opcional)</label>
              <input
                id="student-label"
                type="text"
                value={studentLabel}
                onChange={(e) => setStudentLabel(e.target.value)}
                placeholder="Ex: iniciais ou identificador interno"
                className={`${inputClassName} sm:w-64`}
              />
              <p className="mt-1 max-w-md text-[11px] text-content-muted">
                Fica só no sistema — o documento impresso indica apenas os perfis de adaptação, nunca o aluno (laudo é dado sensível, LGPD).
              </p>
            </div>
            <button
              type="button"
              onClick={createAdaptation}
              disabled={creating || selectedProfiles.length === 0}
              className="min-h-10 rounded bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground transition-colors hover:bg-action-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? 'Enfileirando…' : 'Gerar adaptação (fila)'}
            </button>
          </div>
        </section>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-content-primary">Adaptações desta prova</h2>
        {adaptations.length === 0 && <p className="text-sm text-content-secondary">Nenhuma adaptação criada ainda.</p>}

        {adaptations.map((adaptation) => {
          const isExpanded = expandedId === adaptation.id
          return (
            <div key={adaptation.id} className="rounded-lg border border-border bg-surface shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-content-primary">
                    {adaptation.adaptationProfiles.map((p) => ADAPTATION_LIBRARIES[p]?.label.split(' ')[0] ?? p.toUpperCase()).join(' + ')}
                    {adaptation.targetStudentLabel && <span className="ml-2 text-xs font-normal text-content-muted">({adaptation.targetStudentLabel})</span>}
                  </p>
                  <p className="text-xs text-content-muted">
                    {new Date(adaptation.createdAt).toLocaleString('pt-BR')} · bibliotecas {Object.entries(adaptation.libraryVersions).map(([k, v]) => `${k} v${v}`).join(', ')}
                  </p>
                  {adaptation.status === 'erro' && adaptation.errorMessage && (
                    <p className="mt-1 max-w-xl text-xs text-status-danger">{adaptation.errorMessage}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[adaptation.status]}`}>
                    {STATUS_LABELS[adaptation.status]}
                  </span>
                  {adaptation.status === 'pronto_revisao' && (
                    <>
                      <button onClick={() => setExpandedId(isExpanded ? null : adaptation.id)} className="text-xs font-medium text-action-primary underline">
                        {isExpanded ? 'Fechar revisão' : 'Revisar lado a lado'}
                      </button>
                      <button
                        onClick={() => approve(adaptation.id)}
                        disabled={approvingId === adaptation.id}
                        className="rounded bg-action-primary px-3 py-1.5 text-xs font-medium text-action-primary-foreground transition-colors hover:bg-action-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {approvingId === adaptation.id ? 'Gerando documento…' : 'Aprovar e gerar documento'}
                      </button>
                    </>
                  )}
                  {adaptation.status === 'aprovado' && adaptation.provaAdaptadaDocUrl && (
                    <a href={adaptation.provaAdaptadaDocUrl} target="_blank" rel="noreferrer" className="text-xs font-medium text-action-primary underline">
                      Abrir Prova Adaptada
                    </a>
                  )}
                </div>
              </div>

              {isExpanded && adaptation.adaptedPayload && (
                <div className="space-y-4 border-t border-border p-4">
                  <p className="text-xs text-content-secondary">
                    Confira questão a questão: a adaptação muda a forma de apresentar, nunca o conteúdo avaliado (gabarito, BNCC e Bloom são preservados por construção e conferidos pelo validador).
                  </p>
                  {adaptation.adaptedPayload.questions.map((aq) => {
                    const original = originalByNumber.get(aq.number)
                    if (!original) return null
                    return (
                      <div key={aq.number} className="rounded-lg border border-border p-3">
                        <p className="mb-2 text-sm font-semibold text-content-primary">Questão {aq.number}</p>
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                          <div className="rounded bg-surface-subtle p-3">
                            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-content-muted">Original</p>
                            {original.supportText && <p className="mb-2 whitespace-pre-wrap text-xs text-content-secondary">{original.supportText}</p>}
                            <p className="whitespace-pre-wrap text-sm text-content-primary">{original.statement}</p>
                            {original.alternatives?.map((alt) => (
                              <p key={alt.letter} className="mt-1 text-xs text-content-secondary">{alt.letter}) {alt.text}</p>
                            ))}
                          </div>
                          <div className="rounded bg-action-primary/10 p-3">
                            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-action-primary">Adaptada</p>
                            {aq.supportText && <p className="mb-2 whitespace-pre-wrap text-xs text-content-secondary">{aq.supportText}</p>}
                            <p className="whitespace-pre-wrap text-sm text-content-primary">{aq.statement}</p>
                            {aq.alternatives?.map((alt) => (
                              <p key={alt.letter} className="mt-1 text-xs text-content-secondary">{alt.letter}) {alt.text}</p>
                            ))}
                          </div>
                        </div>
                        <div className="mt-2 space-y-1 text-xs">
                          <p className="text-content-secondary"><span className="font-medium text-content-primary">O que mudou:</span> {aq.adaptation.adaptationNotes}</p>
                          {aq.adaptation.formulaSupport && <p className="text-content-secondary"><span className="font-medium text-content-primary">Apoio de fórmulas:</span> {aq.adaptation.formulaSupport}</p>}
                          {aq.adaptation.visualSupportSuggestion && <p className="text-content-secondary"><span className="font-medium text-content-primary">Apoio visual sugerido:</span> {aq.adaptation.visualSupportSuggestion} <span className="text-content-muted">(inclusão é decisão sua)</span></p>}
                          {aq.adaptation.imageDescription && <p className="text-content-secondary"><span className="font-medium text-content-primary">Descrição da imagem:</span> {aq.adaptation.imageDescription}</p>}
                          {aq.adaptation.removedElements.length > 0 && <p className="text-content-secondary"><span className="font-medium text-content-primary">Distratores removidos:</span> {aq.adaptation.removedElements.join('; ')}</p>}
                          {aq.adaptation.harmonizationNotes && <p className="text-status-warning"><span className="font-medium">Harmonização de perfis:</span> {aq.adaptation.harmonizationNotes}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
