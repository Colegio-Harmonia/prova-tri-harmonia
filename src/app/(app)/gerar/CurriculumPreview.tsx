'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SEGMENT_LABELS, SEGMENT_GRADES, SEGMENT_SUBJECTS } from '@/config/subjects'
import { getEnemAreaForSubject } from '@/config/enemAreaMap'
import type { Segment, CurriculumSelection } from '@/types/exam'
import { GenerationStepper } from '@/features/assessments/components/GenerationStepper'

// Subtarefa 1b (24/07/2026): a geração deixou de ser síncrona — o botão
// final enfileira 1 job por disciplina em /api/generation-jobs (batch) e o
// professor acompanha na aba "Histórico e Fila" de /status. Disciplina
// única continua com o fluxo completo (preview + banco ENEM); multi
// seleção esconde o banco ENEM (a seleção de questão do banco é por
// disciplina/área — a API rejeita banco com mais de uma disciplina).

type SubjectPreview = {
  subject: string
  data?: CurriculumSelection
  error?: string
  availableTabs?: string[]
}

type BankQuestion = {
  id: number
  year: number
  preview: string
  skillCode: string | null
  skillDescription: string | null
  competencyNumber: number | null
  classificationSource: string
  bloomLevel: string | null
  cognitiveAxis: string | null
}

type SkillOption = { code: string; description: string; competencyNumber: number }

type EnqueuedInfo = {
  batchId: number
  jobs: Array<{ jobId: number; subject: string }>
}

const BLOOM_LEVELS = [
  { value: 'lembrar', label: 'Lembrar' },
  { value: 'compreender', label: 'Compreender' },
  { value: 'aplicar', label: 'Aplicar' },
  { value: 'analisar', label: 'Analisar' },
  { value: 'avaliar', label: 'Avaliar' },
  { value: 'criar', label: 'Criar' },
]

const COGNITIVE_AXES = [
  { value: 'DL', label: 'DL — Dominar Linguagens' },
  { value: 'CF', label: 'CF — Compreender Fenômenos' },
  { value: 'SP', label: 'SP — Enfrentar Situações-Problema' },
  { value: 'CA', label: 'CA — Construir Argumentação' },
  { value: 'EP', label: 'EP — Elaborar Propostas' },
]

function UnitList({ units, bnccFilter }: { units: CurriculumSelection['units']; bnccFilter: string }) {
  return (
    <div className="divide-y divide-neutral-200 rounded border border-neutral-200">
      {units
        .filter((unit) => !bnccFilter || (unit.habilidades.status === 'mapeado' && unit.habilidades.skills.some((s) => s.code === bnccFilter)))
        .map((unit) => (
        <div key={unit.rowIndex} className="p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">{unit.tituloCapitulo || '(sem título)'}</span>
            <span className="text-xs text-neutral-400">{unit.bimestre ?? 'período não informado'}</span>
          </div>
          {unit.conteudo && <p className="mt-1 text-neutral-600">{unit.conteudo}</p>}
          <div className="mt-2 flex flex-wrap gap-1">
            {unit.habilidades.status === 'mapeado' ? (
              unit.habilidades.skills.map((s) => (
                <span key={s.code} className="rounded bg-harmonia-green/10 px-2 py-0.5 text-xs text-harmonia-green">
                  {s.code}
                </span>
              ))
            ) : (
              <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">BNCC não mapeada</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function CurriculumPreview() {
  const [segment, setSegment] = useState<Segment>('anos-iniciais')
  const [gradeYear, setGradeYear] = useState<number>(SEGMENT_GRADES['anos-iniciais'][0])
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([SEGMENT_SUBJECTS['anos-iniciais'][0]])
  const [classLabel, setClassLabel] = useState('')
  const [bimester, setBimester] = useState<number | ''>('')
  // Rótulo pedagógico. A TRI INEP é liberada pela presença de itens reais
  // do banco ENEM com calibração oficial, inclusive em provas mistas.
  const [assessmentKind, setAssessmentKind] = useState<'padrao' | 'enem'>('padrao')
  const [loading, setLoading] = useState(false)
  const [previews, setPreviews] = useState<SubjectPreview[]>([])
  const [error, setError] = useState<string | null>(null)
  const [questionCount, setQuestionCount] = useState(12)
  const [academicYear, setAcademicYear] = useState(new Date().getFullYear())
  const [enqueueing, setEnqueueing] = useState(false)
  const [enqueueError, setEnqueueError] = useState<string | null>(null)
  const [enqueued, setEnqueued] = useState<EnqueuedInfo | null>(null)

  const [bankQuestions, setBankQuestions] = useState<BankQuestion[]>([])
  const [bankSelected, setBankSelected] = useState<Set<number>>(new Set())
  const [bankLoading, setBankLoading] = useState(false)
  const [bankError, setBankError] = useState<string | null>(null)
  const [bankSkillOptions, setBankSkillOptions] = useState<SkillOption[]>([])
  const [bloomFilter, setBloomFilter] = useState('')
  const [skillFilter, setSkillFilter] = useState('')
  const [axisFilter, setAxisFilter] = useState('')
  const [bnccFilter, setBnccFilter] = useState('')
  const [step, setStep] = useState<1 | 2 | 3>(1)

  const singleSubject = selectedSubjects.length === 1 ? selectedSubjects[0] : null
  // Banco ENEM só em disciplina única (a API rejeita batch multi + banco).
  const enemArea = singleSubject && segment === 'ensino-medio' ? getEnemAreaForSubject(singleSubject) : null
  const totalCount = questionCount + bankSelected.size
  const totalValid = totalCount >= 12 && totalCount <= 15

  function resetSelectionDependentState() {
    setPreviews([])
    setError(null)
    setBankQuestions([])
    setBankSelected(new Set())
    setBnccFilter('')
    setEnqueued(null)
    setEnqueueError(null)
    setStep(1)
  }

  function handleSegmentChange(next: Segment) {
    setSegment(next)
    setGradeYear(SEGMENT_GRADES[next][0])
    setSelectedSubjects([SEGMENT_SUBJECTS[next][0]])
    setAssessmentKind('padrao')
    resetSelectionDependentState()
  }

  function toggleSubject(subject: string) {
    setSelectedSubjects((prev) => {
      const next = prev.includes(subject) ? prev.filter((s) => s !== subject) : [...prev, subject]
      // Mantém a ordem canônica da lista de disciplinas do segmento.
      return SEGMENT_SUBJECTS[segment].filter((s) => next.includes(s))
    })
    resetSelectionDependentState()
  }

  // Carrega as habilidades oficiais (H1-H30) da área correspondente sempre
  // que ela muda, pra popular o dropdown de filtro — vem da matriz
  // cadastrada, não das questões já buscadas.
  useEffect(() => {
    setBloomFilter('')
    setSkillFilter('')
    setAxisFilter('')
    setBankQuestions([])
    if (!enemArea) {
      setBankSkillOptions([])
      return
    }
    fetch(`/api/enem-bank/skills?area=${enemArea}`)
      .then((res) => res.json())
      .then((data) => setBankSkillOptions(data.skills ?? []))
      .catch(() => setBankSkillOptions([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enemArea])

  // Extraída de handleBankSearch pra poder ser reaproveitada pelo campo
  // numérico "Questões do banco ENEM" — que precisa buscar antes de
  // selecionar automaticamente se a busca ainda não rodou.
  async function fetchBankQuestions(): Promise<BankQuestion[]> {
    if (!enemArea) return []
    setBankLoading(true)
    setBankError(null)
    try {
      const params = new URLSearchParams({ area: enemArea, limit: '40' })
      if (bloomFilter) params.set('bloomLevel', bloomFilter)
      if (skillFilter) params.set('skillCode', skillFilter)
      if (axisFilter) params.set('cognitiveAxis', axisFilter)
      const res = await fetch(`/api/enem-bank/search?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) {
        setBankError(data.error ?? 'Erro ao buscar banco ENEM.')
        return []
      }
      setBankQuestions(data.questions)
      return data.questions
    } catch {
      setBankError('Falha de rede ao buscar banco ENEM.')
      return []
    } finally {
      setBankLoading(false)
    }
  }

  async function handleBankSearch() {
    await fetchBankQuestions()
  }

  function toggleBankQuestion(id: number) {
    setBankSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Campo numérico "Questões do banco ENEM" — em vez de marcar questão por
  // questão, o usuário digita quantas quer e o sistema seleciona
  // automaticamente as N primeiras que batem com os filtros atuais
  // (buscando primeiro, se ainda não tiver buscado). Preserva o que já
  // estava marcado manualmente sempre que possível, só completa/corta a
  // diferença — assim ajustar o número não descarta escolhas manuais à toa.
  async function handleBankCountChange(rawCount: number) {
    const desired = Math.max(0, rawCount)
    let questions = bankQuestions
    if (questions.length === 0 && desired > 0) {
      questions = await fetchBankQuestions()
    }
    const ids = questions.map((q) => q.id)
    const clamped = Math.min(desired, ids.length)
    setBankSelected((prev) => {
      const keep = ids.filter((id) => prev.has(id))
      if (clamped <= keep.length) return new Set(keep.slice(0, clamped))
      const additional = ids.filter((id) => !prev.has(id)).slice(0, clamped - keep.length)
      return new Set([...keep, ...additional])
    })
  }

  // Preview de todas as disciplinas marcadas em paralelo — cada uma pode
  // falhar sozinha (aba não encontrada, planilha não configurada) sem
  // derrubar as outras; o erro fica visível na Conferência pra desmarcar.
  async function handlePreview() {
    setLoading(true)
    setError(null)
    setPreviews([])

    try {
      const settled = await Promise.all(
        selectedSubjects.map(async (subject): Promise<SubjectPreview> => {
          try {
            const res = await fetch('/api/curriculum/preview', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                segment,
                gradeYear,
                subject,
                ...(bimester !== '' ? { bimester } : {}),
              }),
            })
            const data = await res.json()
            if (!res.ok) {
              return { subject, error: data.error ?? 'Erro ao consultar currículo.', availableTabs: data.availableTabs }
            }
            return { subject, data }
          } catch {
            return { subject, error: 'Falha de rede ao consultar currículo.' }
          }
        }),
      )
      setPreviews(settled)
      setStep(2)
    } finally {
      setLoading(false)
    }
  }

  // Disciplina bloqueada pra enfileirar: precisa de conteúdo curricular
  // quando há questão de IA (questionCount > 0). Prova só de banco ENEM
  // (questionCount 0, disciplina única de EM) não depende da planilha.
  function subjectBlockReason(p: SubjectPreview): string | null {
    if (questionCount === 0) return null
    if (p.error) return p.error
    if (!p.data || p.data.units.length === 0) return 'Nenhuma unidade curricular encontrada para os filtros selecionados.'
    return null
  }

  const blockedSubjects = previews.filter((p) => subjectBlockReason(p) !== null)
  const canEnqueue = totalValid && previews.length > 0 && blockedSubjects.length === 0

  async function handleEnqueue() {
    setEnqueueing(true)
    setEnqueueError(null)

    try {
      const res = await fetch('/api/generation-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segment,
          gradeYear,
          academicYear,
          subjects: selectedSubjects,
          ...(classLabel.trim() ? { classLabel: classLabel.trim() } : {}),
          config: {
            questionCount,
            enemBankQuestionIds: Array.from(bankSelected),
            assessmentKind,
            ...(bimester !== '' ? { bimester } : {}),
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setEnqueueError(data.error ?? 'Erro ao adicionar à fila.')
        return
      }
      setEnqueued({ batchId: data.batchId, jobs: data.jobs })
    } catch {
      setEnqueueError('Falha de rede ao adicionar à fila.')
    } finally {
      setEnqueueing(false)
    }
  }

  // Tela de sucesso pós-enfileiramento: a geração roda em segundo plano,
  // o professor pode continuar navegando.
  if (enqueued) {
    return (
      <div className="space-y-4 rounded border border-harmonia-green/30 bg-harmonia-green/5 p-6">
        <p className="text-sm font-semibold text-harmonia-green">
          {enqueued.jobs.length === 1 ? 'Prova adicionada à fila de geração ✅' : `${enqueued.jobs.length} provas adicionadas à fila de geração ✅`}
        </p>
        <ul className="list-disc pl-5 text-sm text-content-secondary">
          {enqueued.jobs.map((j) => (
            <li key={j.jobId}>{j.subject} — {gradeYear}º ano{classLabel.trim() ? ` (${classLabel.trim()})` : ''}</li>
          ))}
        </ul>
        <p className="text-xs text-content-muted">
          Você pode continuar usando o sistema normalmente — a geração acontece em segundo plano e você recebe um aviso quando cada prova ficar pronta pra revisão.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/status?aba=fila" className="min-h-10 rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white">
            Acompanhar na fila
          </Link>
          <button
            onClick={() => {
              setEnqueued(null)
              resetSelectionDependentState()
            }}
            className="min-h-10 rounded border border-border px-4 py-2 text-sm font-medium"
          >
            Gerar outra prova
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <GenerationStepper currentStep={step} />

      {step === 1 && <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="text-sm font-medium">Segmento</label>
          <select
            className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            value={segment}
            onChange={(e) => handleSegmentChange(e.target.value as Segment)}
          >
            {(Object.keys(SEGMENT_LABELS) as Segment[]).map((s) => (
              <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">Ano</label>
          <select
            className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            value={gradeYear}
            onChange={(e) => { setGradeYear(Number(e.target.value)); resetSelectionDependentState() }}
          >
            {SEGMENT_GRADES[segment].map((g) => (
              <option key={g} value={g}>{g}º ano</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">Turma (opcional)</label>
          <input
            type="text"
            placeholder={`Ex: ${gradeYear}º Ano A`}
            value={classLabel}
            onChange={(e) => setClassLabel(e.target.value)}
            className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </div>

        <div>
          <label className="text-sm font-medium">Bimestre (opcional)</label>
          <select
            className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            value={bimester}
            onChange={(e) => { setBimester(e.target.value === '' ? '' : Number(e.target.value)); resetSelectionDependentState() }}
          >
            <option value="">Ano todo</option>
            {[1, 2, 3, 4].map((b) => (
              <option key={b} value={b}>{b}º bimestre</option>
            ))}
          </select>
        </div>

        {segment === 'ensino-medio' && (
          <div>
            <label className="text-sm font-medium">Tipo de avaliação</label>
            <select
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
              value={assessmentKind}
              onChange={(e) => setAssessmentKind(e.target.value as 'padrao' | 'enem')}
            >
              <option value="padrao">Prova</option>
              <option value="enem">Simulado ENEM</option>
            </select>
            <p className="mt-0.5 text-[11px] text-neutral-400">A TRI INEP é calculada somente com questões reais do banco ENEM que tenham calibração oficial. Em provas mistas, o percentual geral continua considerando todas as questões.</p>
          </div>
        )}
      </div>

      <fieldset className="rounded border border-neutral-200 bg-white p-4">
        <legend className="px-1 text-sm font-medium">Disciplinas</legend>
        <p className="mb-3 text-xs text-neutral-400">
          Marque uma ou mais — cada disciplina vira uma prova separada na fila de geração.
          {segment === 'ensino-medio' && ' O banco de questões reais do ENEM fica disponível quando só uma disciplina está marcada.'}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SEGMENT_SUBJECTS[segment].map((s) => (
            <label key={s} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded border px-3 text-sm ${selectedSubjects.includes(s) ? 'border-harmonia-green bg-harmonia-green/5 font-medium' : 'border-neutral-200'}`}>
              <input
                type="checkbox"
                checked={selectedSubjects.includes(s)}
                onChange={() => toggleSubject(s)}
              />
              {s}
            </label>
          ))}
        </div>
        {selectedSubjects.length > 1 && (
          <p className="mt-2 text-xs font-medium text-harmonia-green">{selectedSubjects.length} disciplinas selecionadas — serão {selectedSubjects.length} provas na fila.</p>
        )}
      </fieldset>

      <button
        onClick={handlePreview}
        disabled={loading || selectedSubjects.length === 0}
        className="min-h-10 rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {loading ? 'Consultando currículo…' : 'Continuar para composição'}
      </button>
      </>}

      {step === 2 && enemArea && (
        <div className="rounded border border-neutral-200 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-neutral-700">Banco de questões reais do ENEM</p>
              <p className="text-xs text-neutral-400">
                Área correspondente: {enemArea} — escolha manualmente quais entram na prova, ao lado das geradas por IA. Não precisa de &quot;Ver conteúdo&quot; pra buscar aqui.
              </p>
            </div>
            <button
              onClick={handleBankSearch}
              disabled={bankLoading}
              className="min-h-10 rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium disabled:opacity-60"
            >
              {bankLoading ? 'Buscando…' : bankQuestions.length ? 'Buscar de novo' : 'Buscar questões do banco'}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <label className="text-xs font-medium text-neutral-500">Bloom</label>
              <select
                className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-xs"
                value={bloomFilter}
                onChange={(e) => setBloomFilter(e.target.value)}
              >
                <option value="">Todos</option>
                {BLOOM_LEVELS.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500">Habilidade (matriz ENEM)</label>
              <select
                className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-xs"
                value={skillFilter}
                onChange={(e) => setSkillFilter(e.target.value)}
              >
                <option value="">Todas</option>
                {bankSkillOptions.map((s) => (
                  <option key={s.code} value={s.code} title={s.description}>{s.code} — C{s.competencyNumber}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500">Eixo cognitivo</label>
              <select
                className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-xs"
                value={axisFilter}
                onChange={(e) => setAxisFilter(e.target.value)}
              >
                <option value="">Todos</option>
                {COGNITIVE_AXES.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>
          </div>

          {bankError && <p className="mt-2 text-xs text-red-600">{bankError}</p>}

          {bankQuestions.length > 0 && (
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              {bankQuestions.map((q) => (
                <label
                  key={q.id}
                  className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-xs ${bankSelected.has(q.id) ? 'border-harmonia-green bg-harmonia-green/5' : 'border-neutral-200'}`}
                >
                  <input
                    type="checkbox"
                    checked={bankSelected.has(q.id)}
                    onChange={() => toggleBankQuestion(q.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">ENEM {q.year}</span>
                      {q.skillCode ? (
                        <span
                          className={`rounded px-1.5 py-0.5 font-medium ${q.classificationSource === 'oficial' ? 'bg-harmonia-green/10 text-harmonia-green' : 'bg-amber-50 text-amber-700'}`}
                          title={q.skillDescription ?? undefined}
                        >
                          {q.skillCode}{q.classificationSource === 'oficial' ? ' (oficial)' : ' (estimado)'}
                        </span>
                      ) : (
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-400">sem habilidade classificada</span>
                      )}
                      {q.bloomLevel && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">{q.bloomLevel}</span>}
                      {q.cognitiveAxis && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700">{q.cognitiveAxis}</span>}
                    </div>
                    <p className="mt-1 text-neutral-600">{q.preview}…</p>
                  </div>
                </label>
              ))}
            </div>
          )}

          {bankSelected.size > 0 && (
            <p className="mt-2 text-xs font-medium text-harmonia-green">{bankSelected.size} questão(ões) do banco selecionada(s)</p>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4 rounded border border-border bg-surface p-4 sm:flex-row sm:items-end">
          {enemArea && <div><label className="text-sm font-medium">Questões do banco ENEM</label><input type="number" min={0} max={15} value={bankSelected.size} onChange={(e) => handleBankCountChange(Number(e.target.value))} disabled={bankLoading} className="mt-1 w-24 rounded border border-border bg-surface px-2 py-1.5 text-sm disabled:opacity-60" /><p className="mt-0.5 text-[11px] text-content-muted">{bankLoading ? 'buscando…' : bankQuestions.length ? `de ${bankQuestions.length} encontradas` : 'usa os filtros acima'}</p></div>}
          <div><label className="text-sm font-medium">Questões geradas por IA</label><input type="number" min={0} max={15} value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))} className="mt-1 w-24 rounded border border-border bg-surface px-2 py-1.5 text-sm" /></div>
          <div><label className="text-sm font-medium">Ano letivo</label><input type="number" min={2020} max={2100} value={academicYear} onChange={(e) => setAcademicYear(Number(e.target.value))} className="mt-1 w-24 rounded border border-border bg-surface px-2 py-1.5 text-sm" /></div>
          <p className="text-xs text-content-secondary">
            Total por prova: <span className={totalValid ? 'font-semibold text-content-primary' : 'font-semibold text-status-danger'}>{totalCount}</span> ({questionCount} IA + {bankSelected.size} banco), entre 12 e 15.
            {selectedSubjects.length > 1 && ` A mesma composição vale pras ${selectedSubjects.length} disciplinas.`}
          </p>
          <div className="flex gap-2"><button onClick={() => setStep(1)} className="min-h-10 rounded border border-border px-4 text-sm font-medium">Voltar</button><button onClick={() => setStep(3)} disabled={!totalValid} className="min-h-10 rounded bg-harmonia-green px-4 text-sm font-medium text-white disabled:opacity-60">Conferir</button></div>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>{error}</p>
        </div>
      )}

      {step === 3 && previews.length > 0 && (
        <div className="space-y-4">
          {previews.map((p) => {
            const blockReason = subjectBlockReason(p)
            return (
              <details key={p.subject} open={previews.length === 1} className={`rounded border p-4 ${blockReason ? 'border-red-200 bg-red-50/40' : 'border-neutral-200 bg-white'}`}>
                <summary className="cursor-pointer text-sm">
                  <span className="font-medium">{p.subject}</span>{' '}
                  {p.data ? (
                    <span className="text-neutral-500">
                      — aba <span className="font-mono">{p.data.tabName}</span>, {p.data.units.length} unidade(s) curricular(es)
                    </span>
                  ) : (
                    <span className="text-red-600">— {p.error}</span>
                  )}
                </summary>

                {blockReason && (
                  <p className="mt-2 text-xs text-red-600">
                    {blockReason} Desmarque essa disciplina (ou ajuste os filtros) pra liberar a fila.
                    {p.availableTabs && p.availableTabs.length > 0 && ` Abas disponíveis: ${p.availableTabs.join(', ')}`}
                  </p>
                )}

                {p.data && (
                  <div className="mt-3 space-y-3">
                    {p.data.unmappedWarnings.length > 0 && (
                      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        <p className="font-medium">Avisos</p>
                        <ul className="mt-1 list-disc pl-5">
                          {p.data.unmappedWarnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {segment === 'ensino-medio' && previews.length === 1 && (
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-neutral-500">Filtrar por código BNCC</label>
                        <select
                          className="rounded border border-neutral-300 px-2 py-1 text-xs"
                          value={bnccFilter}
                          onChange={(e) => setBnccFilter(e.target.value)}
                        >
                          <option value="">Todos os códigos</option>
                          {Array.from(
                            new Set(
                              p.data.units.flatMap((u) => (u.habilidades.status === 'mapeado' ? u.habilidades.skills.map((s) => s.code) : [])),
                            ),
                          )
                            .sort()
                            .map((code) => (
                              <option key={code} value={code}>{code}</option>
                            ))}
                        </select>
                      </div>
                    )}

                    <UnitList units={p.data.units} bnccFilter={previews.length === 1 ? bnccFilter : ''} />
                  </div>
                )}
              </details>
            )
          })}

          <div className="flex flex-col gap-4 rounded border border-border bg-surface p-4 sm:flex-row sm:items-end">
            <p className="text-sm text-content-secondary">
              {selectedSubjects.length === 1
                ? `Conferência: ${questionCount} questão(ões) por IA e ${bankSelected.size} do banco ENEM.`
                : `Conferência: ${selectedSubjects.length} provas (${selectedSubjects.join(', ')}), cada uma com ${questionCount} questão(ões) por IA.`}{' '}
              A geração roda em segundo plano — acompanhe na aba Histórico e Fila e revise cada prova antes de aprovar.
            </p>
            <button onClick={() => setStep(2)} disabled={enqueueing} className="min-h-10 rounded border border-border px-4 py-2 text-sm font-medium">Voltar</button>
            <button
              onClick={handleEnqueue}
              disabled={enqueueing || !canEnqueue}
              className="min-h-10 whitespace-nowrap rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {enqueueing ? 'Adicionando…' : selectedSubjects.length > 1 ? `Adicionar ${selectedSubjects.length} provas à fila` : 'Adicionar à fila'}
            </button>
          </div>

          {enqueueError && (
            <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{enqueueError}</div>
          )}
        </div>
      )}
    </div>
  )
}
