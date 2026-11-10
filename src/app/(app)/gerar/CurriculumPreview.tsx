'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recommendCreationMode } from '@/lib/exams/creationMode'
import Link from 'next/link'
import { ClipboardPenLine, Sparkles, BadgeCheck } from 'lucide-react'
import { LazyMathText as MathText } from '@/components/ui/LazyMathText'
import { SEGMENT_LABELS, SEGMENT_GRADES, SEGMENT_SUBJECTS } from '@/config/subjects'
import { getEnemAreaForSubject } from '@/config/enemAreaMap'
import { currentBimester } from '@/lib/exams/currentBimester'
import { evenQuestionCounts } from '@/lib/exams/chapterDistribution'
import { composeWithEnem } from '@/lib/exams/enemComposition'
import type { Segment, CurriculumPlanItem, CurriculumSelection } from '@/types/exam'
import QuestionCompositionControls from './QuestionCompositionControls'
import { GenerationStepper } from '@/features/assessments/components/GenerationStepper'

// Subtarefa 1b (24/07/2026): a geração deixou de ser síncrona — o botão
// final enfileira 1 job por disciplina em /api/generation-jobs (batch) e o
// professor acompanha na aba "Histórico e Fila" de /status. Disciplina
// única continua com o fluxo completo (preview + banco ENEM); multi
// seleção esconde o banco ENEM (a seleção de questão do banco é por
// disciplina/área — a API rejeita banco com mais de uma disciplina).

type SubjectPreview = {
  subject: string
  curriculumPlanId?: number
  data?: CurriculumSelection
  error?: string
  availableTabs?: string[]
}

type BankQuestion = {
  id: number
  year: number
  questionIndex: number
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
            ) : unit.enemSkills?.skills.length ? null : (
              // Capítulo mapeado pela Matriz do ENEM não é lacuna de planejamento.
              <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">BNCC não mapeada</span>
            )}
            {unit.enemSkills?.skills.map((s) => (
              <span
                key={`enem-${s.code}`}
                title={s.description ?? undefined}
                className="rounded border border-harmonia-green/40 px-2 py-0.5 text-xs text-harmonia-green"
              >
                ENEM {s.code}{s.count > 1 ? ` ×${s.count}` : ''}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

type TeacherOption = { id: number; name: string; email: string }

// Converte a posição do ponteiro na largura da barra em uma quantidade de
// questões (0..total). É a base do gráfico interativo: o mesmo gesto cobre
// clique e arraste.
function questionsFromPointer(element: HTMLElement, clientX: number, total: number): number {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || total <= 0) return 0
  const ratio = (clientX - rect.left) / rect.width
  return Math.max(0, Math.min(total, Math.round(ratio * total)))
}

type CurrentUser = { id: number; name: string; email: string; role: string }

export default function CurriculumPreview({ coordinator, teachers, currentUser }: { coordinator: boolean; teachers: TeacherOption[]; currentUser: CurrentUser | null }) {
  const router = useRouter()
  const [choosingMode, setChoosingMode] = useState(false)
  const [manualSubject, setManualSubject] = useState('')
  const [creatingManual, setCreatingManual] = useState(false)
  // A tela abre zerada: cada campo é escolha explícita de quem gera.
  // Exceções deliberadas: o responsável já vem como o próprio professor
  // (a prova nasce atribuída a ele) e o bimestre já vem no período atual.
  const [segment, setSegment] = useState<Segment | ''>('')
  const [gradeYear, setGradeYear] = useState<number | ''>('')
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([])
  const [classLabel, setClassLabel] = useState('')
  const [bimester, setBimester] = useState<number | ''>(currentBimester())
  // Rótulo pedagógico. A TRI INEP é liberada pela presença de itens reais
  // do banco ENEM com calibração oficial, inclusive em provas mistas.
  const [assessmentKind, setAssessmentKind] = useState<'padrao' | 'enem'>('padrao')
  const [loading, setLoading] = useState(false)
  const [previews, setPreviews] = useState<SubjectPreview[]>([])
  const [error, setError] = useState<string | null>(null)
  const [questionCount, setQuestionCount] = useState(12)
  const [questionSource, setQuestionSource] = useState<'acervo' | 'ia'>('acervo')
  // 100% fica à esquerda (alternativas) e 0% à direita (dissertativas),
  // acompanhando a metáfora visual escolhida para este controle.
  const [objectivePercentage, setObjectivePercentage] = useState(70)
  const [academicYear, setAcademicYear] = useState(new Date().getFullYear())
  const [enqueueing, setEnqueueing] = useState(false)
  const [enqueueError, setEnqueueError] = useState<string | null>(null)
  const [enqueued, setEnqueued] = useState<EnqueuedInfo | null>(null)
  const [assignedTo, setAssignedTo] = useState<number | ''>(currentUser && !coordinator ? currentUser.id : '')

  const [bankQuestions, setBankQuestions] = useState<BankQuestion[]>([])
  const [bankSelected, setBankSelected] = useState<Set<number>>(new Set())
  const [bankLoading, setBankLoading] = useState(false)
  const [bankCountPending, setBankCountPending] = useState(false)
  const [bankYear, setBankYear] = useState('')
  const [bankQuestionIndex, setBankQuestionIndex] = useState('')
  const [bankQuery, setBankQuery] = useState('')
  const [bankSearched, setBankSearched] = useState(false)
  const [bankError, setBankError] = useState<string | null>(null)
  const [bankPlanningNote, setBankPlanningNote] = useState<string | null>(null)
  const [bankSkillOptions, setBankSkillOptions] = useState<SkillOption[]>([])
  const [bloomFilter, setBloomFilter] = useState('')
  const [skillFilter, setSkillFilter] = useState('')
  const [axisFilter, setAxisFilter] = useState('')
  const [bnccFilter, setBnccFilter] = useState('')
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [contentPlan, setContentPlan] = useState<CurriculumPlanItem[]>([])
  const [chapterCounts, setChapterCounts] = useState<Record<number, number>>({})
  const draggingRowRef = useRef<number | null>(null)
  const bankSelectionRequestRef = useRef(0)
  const bankLoadingRequestRef = useRef(0)
  const previewRequestRef = useRef(0)

  const singleSubject = selectedSubjects.length === 1 ? selectedSubjects[0] : null
  // Banco ENEM só em disciplina única (a API rejeita batch multi + banco).
  const enemArea = singleSubject && segment === 'ensino-medio' ? getEnemAreaForSubject(singleSubject) : null
  const totalCount = questionCount + bankSelected.size
  useEffect(() => {
    bankSelectionRequestRef.current++
  }, [enemArea, bankYear, bankQuestionIndex, bankQuery, bloomFilter, skillFilter, axisFilter, totalCount, contentPlan, classLabel, academicYear, objectivePercentage])
  const totalValid = totalCount >= 10 && totalCount <= 30
  const objectiveTarget = Math.round(totalCount * objectivePercentage / 100)
  const aiObjectiveCount = Math.max(0, Math.min(questionCount, objectiveTarget - bankSelected.size))
  const effectiveObjectiveCount = bankSelected.size + aiObjectiveCount
  const contentPlanTotal = contentPlan.reduce((sum, item) => sum + item.questionCount, 0)
  const contentPlanValid = !singleSubject || contentPlan.length === 0 || contentPlanTotal === totalCount
  // Sem permitir avançar com campo em branco: segmento, responsável (só a
  // coordenação escolhe, o professor já vem atribuído a si), ano e disciplinas.
  const canContinue = segment !== '' && gradeYear !== '' && selectedSubjects.length > 0 && (!coordinator || assignedTo !== '')

  function contentPlanFromCounts(units: CurriculumSelection['units'], counts: Record<number, number>, previous = contentPlan): CurriculumPlanItem[] {
    return units.map((unit) => {
      const existing = previous.find((item) => item.unitRowIndex === unit.rowIndex)
      return { unitRowIndex: unit.rowIndex, questionCount: counts[unit.rowIndex] ?? 0, priority: existing?.priority ?? 'media', visualAid: existing?.visualAid ?? 'auto' }
    })
  }

  function changeQuestionCount(value: number, plannedTotal = value + bankSelected.size) {
    const next = Math.max(0, Math.min(30, value))
    setQuestionCount(next)
    const units = previews[0]?.data?.units ?? []
    // Changing the total scales the current chapter proportions. Editing a
    // chapter still changes only that chapter, and Equilibrar remains explicit.
    const total = units.reduce((sum, unit) => sum + (chapterCounts[unit.rowIndex] ?? 0), 0)
    const counts = total > 0 ? Object.fromEntries(units.map((unit) => [unit.rowIndex, Math.floor(plannedTotal * (chapterCounts[unit.rowIndex] ?? 0) / total)])) : evenQuestionCounts(units.map((unit) => unit.rowIndex), plannedTotal)
    if (total > 0) {
      const order = [...units].sort((a, b) => (plannedTotal * (chapterCounts[b.rowIndex] ?? 0) / total) % 1 - (plannedTotal * (chapterCounts[a.rowIndex] ?? 0) / total) % 1)
      let remaining = plannedTotal - Object.values(counts).reduce((sum, count) => sum + count, 0)
      for (const unit of order) { if (remaining-- <= 0) break; counts[unit.rowIndex] = (counts[unit.rowIndex] ?? 0) + 1 }
    }
    setChapterCounts(counts)
    setContentPlan(contentPlanFromCounts(units, counts))
  }

  function applyBankSelection(ids: Iterable<number>, total = totalCount) {
    const composition = composeWithEnem(total, ids)
    setBankSelected(new Set(composition.bankIds))
    changeQuestionCount(composition.questionCount, total)
  }

  function changeTotalCount(value: number) {
    bankSelectionRequestRef.current++
    applyBankSelection(bankSelected, Math.max(10, Math.min(30, value)))
  }

  function changeChapterCount(rowIndex: number, value: number) {
    const units = previews[0]?.data?.units ?? []
    if (!units.length) return
    // Escolha livre: altera só o capítulo ajustado, sem rebalancear os outros.
    const next = { ...chapterCounts, [rowIndex]: Math.max(0, Math.min(totalCount, Math.round(value))) }
    setChapterCounts(next)
    setContentPlan(contentPlanFromCounts(units, next))
  }

  // Restaura a distribuição uniforme das questões entre os capítulos.
  function balanceChapterCounts() {
    const units = previews[0]?.data?.units ?? []
    if (!units.length) return
    const counts = evenQuestionCounts(units.map((unit) => unit.rowIndex), totalCount)
    setChapterCounts(counts)
    setContentPlan(contentPlanFromCounts(units, counts))
  }

  function resetSelectionDependentState() {
    previewRequestRef.current++
    setLoading(false)
    setChoosingMode(false)
    bankSelectionRequestRef.current++
    setQuestionCount(totalCount)
    setPreviews([])
    setError(null)
    setBankQuestions([])
    setBankSelected(new Set())
    setBnccFilter('')
    setEnqueued(null)
    setEnqueueError(null)
    setContentPlan([])
    setChapterCounts({})
    setStep(1)
  }

  function handleSegmentChange(next: Segment) {
    setSegment(next)
    setGradeYear('')
    setSelectedSubjects([])
    setAssessmentKind('padrao')
    resetSelectionDependentState()
  }

  function toggleSubject(subject: string) {
    setSelectedSubjects((prev) => {
      const next = prev.includes(subject) ? prev.filter((s) => s !== subject) : [...prev, subject]
      // Mantém a ordem canônica da lista de disciplinas do segmento.
      return (segment ? SEGMENT_SUBJECTS[segment] : []).filter((s) => next.includes(s))
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
    setBankYear('')
    setBankQuestionIndex('')
    setBankQuery('')
    setBankSearched(false)
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

  async function requestBankRecommendations(count: number, preferredIds: number[] = []) {
    const reference = previews[0]?.data?.planReference
    if (!reference || !singleSubject || gradeYear === '' || bimester === '' || !contentPlanValid) {
      throw new Error('Carregue o planejamento aprovado e confira a distribuição por capítulos antes de buscar questões ENEM.')
    }
    const response = await fetch('/api/enem-bank/recommend', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        curriculumPlanId: reference.planId, curriculumPlanVersionId: reference.versionId,
        subject: singleSubject, gradeYear, academicYear, bimester, classLabel: classLabel.trim() || undefined,
        count, total: totalCount, objectivePercentage, contentPlan, preferredIds,
        filters: {
          year: bankYear ? Number(bankYear) : undefined,
          questionIndex: bankQuestionIndex ? Number(bankQuestionIndex) : undefined,
          q: bankQuery.trim() || undefined, bloomLevel: bloomFilter || undefined,
          skillCode: skillFilter || undefined, cognitiveAxis: axisFilter || undefined,
        },
      }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? 'Não foi possível conferir o banco ENEM.')
    return result
  }

  async function fetchBankQuestions(): Promise<void> {
    if (!enemArea) return
    const request = ++bankSelectionRequestRef.current
    bankLoadingRequestRef.current = request
    setBankLoading(true)
    setBankError(null)
    setBankPlanningNote(null)
    try {
      const result = await requestBankRecommendations(Math.max(1, effectiveObjectiveCount))
      if (request !== bankSelectionRequestRef.current) return
      setBankQuestions(result.questions ?? [])
      setBankSearched(true)
      setBankPlanningNote((result.warnings ?? []).join(' ') || 'Questões conferidas com o conteúdo e as habilidades do planejamento.')
    } catch (failure) {
      if (request === bankSelectionRequestRef.current) setBankError(failure instanceof Error ? failure.message : 'Falha ao consultar o banco ENEM.')
    } finally {
      if (request === bankLoadingRequestRef.current) setBankLoading(false)
    }
  }

  async function handleBankSearch() {
    await fetchBankQuestions()
  }

  function toggleBankQuestion(id: number) {
    bankSelectionRequestRef.current++
    const next = new Set(bankSelected)
    if (next.has(id)) next.delete(id)
    else if (next.size < totalCount) next.add(id)
    else { setBankError('O total da prova já foi preenchido. Desmarque uma questão antes de escolher outra.'); return }
    setBankError(null)
    applyBankSelection(next)
  }

  // A quantidade e a busca manual compartilham a mesma conferência do planejamento.
  async function handleBankCountChange(rawCount: number) {
    if (!Number.isFinite(rawCount)) return
    const desired = Math.min(totalCount, Math.max(0, Math.floor(rawCount)))
    const request = ++bankSelectionRequestRef.current
    setBankError(null)
    if (desired <= bankSelected.size) {
      applyBankSelection([...bankSelected].slice(0, desired))
      return
    }
    const preview = previews[0]
    const reference = preview?.data?.planReference
    if (!reference || !singleSubject || gradeYear === '' || bimester === '' || !contentPlanValid) {
      setBankError('Carregue o planejamento aprovado e confira a distribuição por capítulos antes de buscar questões ENEM.')
      return
    }
    bankLoadingRequestRef.current = request
    setBankLoading(true)
    setBankPlanningNote(null)
    try {
      const result = await requestBankRecommendations(desired, [...bankSelected])
      if (request !== bankSelectionRequestRef.current) return
      setBankPlanningNote((result.warnings ?? []).join(' ') || 'Questões conferidas com o conteúdo, as habilidades e o contexto da turma.')
      if (!result.complete) {
        setBankError(`Encontradas ${result.assignments.length} de ${desired} questões compatíveis. A seleção anterior foi mantida. Revise a quantidade ou escolha os itens manualmente.`)
        return
      }
      setBankQuestions(result.questions ?? [])
      setBankSearched(true)
      applyBankSelection(result.assignments.map((assignment: { questionId: number }) => assignment.questionId))
    } catch (failure) {
      if (request === bankSelectionRequestRef.current) setBankError(failure instanceof Error ? failure.message : 'Falha ao consultar o banco ENEM.')
    } finally { if (request === bankLoadingRequestRef.current) setBankLoading(false) }

  }

  // Usa o planejamento aprovado na aba Planejamentos; não consulta a planilha
  // durante a geração. Cada disciplina é resolvida e pré-visualizada em paralelo.
  async function handlePreview() {
    const request = ++previewRequestRef.current
    setLoading(true)
    setError(null)
    setPreviews([])

    try {
      const settled = await Promise.all(
        selectedSubjects.map(async (subject): Promise<SubjectPreview> => {
          try {
            const query = new URLSearchParams({ academicYear: String(academicYear), segment, gradeYear: String(gradeYear), subject })
            if (bimester !== '') query.set('bimester', String(bimester))
            const plansRes = await fetch(`/api/curriculum/plans?${query}`)
            const plansData = await plansRes.json()
            if (!plansRes.ok) return { subject, error: plansData.error ?? 'Não foi possível consultar Planejamentos.' }
            const matching = (plansData.plans ?? []).filter((plan: { official?: { status?: string } }) => plan.official?.status === 'aprovado')
            if (matching.length !== 1) {
              return { subject, error: matching.length
                ? 'Há mais de um planejamento aprovado para este recorte. Revise a aba Planejamentos.'
                : 'Não há planejamento aprovado para esta disciplina, série e bimestre. Aprove-o na aba Planejamentos antes de gerar.' }
            }
            const curriculumPlanId = matching[0].id as number
            const res = await fetch('/api/curriculum/preview', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                segment,
                gradeYear,
                academicYear,
                subject,
                ...(bimester !== '' ? { bimester } : {}),
                curriculumPlanId,
              }),
            })
            const data = await res.json()
            if (!res.ok) {
              return { subject, error: data.error ?? 'Erro ao consultar o planejamento.' }
            }
            return { subject, data, curriculumPlanId }
          } catch {
            return { subject, error: 'Falha de rede ao consultar Planejamentos.' }
          }
        }),
      )
      if (request !== previewRequestRef.current) return
      setPreviews(settled)
      const available = settled.length === 1 ? settled[0].data?.units ?? [] : []
      const counts = evenQuestionCounts(available.map((unit) => unit.rowIndex), questionCount)
      setChapterCounts(counts)
      setContentPlan(contentPlanFromCounts(available, counts, []))
      setManualSubject(settled.find((preview) => !preview.data?.units.some((unit) => unit.habilidades.status === 'mapeado' && unit.habilidades.skills.length > 0))?.subject ?? selectedSubjects[0] ?? '')
      setChoosingMode(true)
    } finally {
      if (request === previewRequestRef.current) setLoading(false)
    }
  }

  async function startManual() {
    setCreatingManual(true)
    setError(null)
    try {
      const response = await fetch('/api/exams/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        segment, gradeYear, academicYear, subject: manualSubject, classLabel: classLabel.trim() || undefined,
        ...(bimester !== '' ? { bimester } : {}), ...(assignedTo !== '' ? { assignedTo } : {}),
      }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Não foi possível iniciar a prova.')
      router.push(`/gerar/manual/${result.examId}`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Falha ao iniciar a prova.') }
    finally { setCreatingManual(false) }
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
  const canEnqueue = !bankLoading && !bankCountPending && totalValid && contentPlanValid && previews.length > 0 && blockedSubjects.length === 0

  function formatEnqueueValidationError(data: { error?: string; issues?: Array<{ path?: Array<string | number>; message?: string }> }) {
    const issue = data.issues?.[0]
    if (!issue) return data.error ?? 'Erro ao adicionar à fila.'
    const path = issue.path?.join('.') ?? ''
    if (path.includes('contentPlan')) return `Revise a matriz da avaliação: ${issue.message ?? 'há um capítulo inválido.'}`
    if (path.includes('questionCount') || path.includes('enemBankQuestionIds')) return `Revise a quantidade de questões: ${issue.message ?? 'a composição é inválida.'}`
    return `${data.error ?? 'Parâmetros inválidos'}: ${issue.message ?? 'revise os dados informados.'}`
  }

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
            questionSource,
            objectivePercentage,
            enemBankQuestionIds: Array.from(bankSelected),
            assessmentKind,
            ...(bimester !== '' ? { bimester } : {}),
            ...(singleSubject && contentPlan.length ? { contentPlan, contentPlanIncludesEnem: true } : {}),
            curriculumPlanVersionIds: Object.fromEntries(previews.filter((preview) => preview.data?.planReference).map((preview) => [preview.subject, preview.data!.planReference!.versionId])),
            ...(previews.length ? { curriculumPlanIds: Object.fromEntries(previews.filter((preview) => preview.curriculumPlanId).map((preview) => [preview.subject, preview.curriculumPlanId!])) } : {}),
            ...(coordinator && assignedTo !== '' ? { assignedTo } : {}),
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setEnqueueError(formatEnqueueValidationError(data))
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

      {step === 1 && !choosingMode && <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="text-sm font-medium" htmlFor="gerar-segmento">Segmento</label>
          <select
            id="gerar-segmento"
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
            value={segment}
            onChange={(e) => {
              const value = e.target.value
              if (!value) { setSegment(''); setGradeYear(''); setSelectedSubjects([]); resetSelectionDependentState(); return }
              handleSegmentChange(value as Segment)
            }}
          >
            <option value="">Selecione o segmento</option>
            {(Object.keys(SEGMENT_LABELS) as Segment[]).map((s) => (
              <option key={s} value={s}>{SEGMENT_LABELS[s]}</option>
            ))}
          </select>
        </div>

        {coordinator ? (
          <div>
            <label className="text-sm font-medium" htmlFor="gerar-professor">Professor responsável</label>
            <select id="gerar-professor" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value ? Number(e.target.value) : '')} className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm">
              <option value="">Selecione o e-mail do professor</option>
              {teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.name} — {teacher.email}</option>)}
            </select>
          </div>
        ) : currentUser ? (
          <div>
            <label className="text-sm font-medium" htmlFor="gerar-professor">Professor responsável</label>
            <input id="gerar-professor" type="text" readOnly value={`${currentUser.name} — ${currentUser.email}`} aria-readonly="true" className="mt-1 w-full rounded border border-border bg-surface-subtle px-2 py-1.5 text-sm text-content-secondary" />
          </div>
        ) : null}

        <div>
          <label className="text-sm font-medium" htmlFor="gerar-ano">Ano</label>
          <select
            id="gerar-ano"
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm disabled:opacity-60"
            value={gradeYear}
            disabled={segment === ''}
            onChange={(e) => { setGradeYear(e.target.value ? Number(e.target.value) : ''); resetSelectionDependentState() }}
          >
            <option value="">Selecione o ano</option>
            {segment !== '' && SEGMENT_GRADES[segment].map((g) => (
              <option key={g} value={g}>{g}º ano</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">Turma (opcional)</label>
          <input
            type="text"
            placeholder={gradeYear === '' ? 'Ex: 2º Ano A' : `Ex: ${gradeYear}º Ano A`}
            value={classLabel}
            onChange={(e) => setClassLabel(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
          />
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="gerar-bimestre">Bimestre (opcional)</label>
          <select
            id="gerar-bimestre"
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
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
            <label className="text-sm font-medium" htmlFor="gerar-tipo">Tipo de avaliação</label>
            <select
              id="gerar-tipo"
              className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
              value={assessmentKind}
              onChange={(e) => setAssessmentKind(e.target.value as 'padrao' | 'enem')}
            >
              <option value="padrao">Prova</option>
              <option value="enem">Simulado ENEM</option>
            </select>
            <p className="mt-0.5 text-[11px] text-content-muted">A TRI INEP é calculada somente com questões reais do banco ENEM que tenham calibração oficial. Em provas mistas, o percentual geral continua considerando todas as questões.</p>
          </div>
        )}
      </div>

      <fieldset className="rounded border border-border bg-surface p-4">
        <legend className="px-1 text-sm font-medium">Disciplinas</legend>
        <p className="mb-3 text-xs text-content-muted">
          Marque uma ou mais — cada disciplina vira uma prova separada na fila de geração.
          {segment === 'ensino-medio' && ' O banco de questões reais do ENEM fica disponível quando só uma disciplina está marcada.'}
        </p>
        {segment === '' ? (
          <p className="text-sm text-content-muted">Selecione um segmento para ver as disciplinas.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {SEGMENT_SUBJECTS[segment].map((s) => (
                <label key={s} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded border px-3 text-sm ${selectedSubjects.includes(s) ? 'border-harmonia-green bg-harmonia-green/5 font-medium' : 'border-border'}`}>
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
          </>
        )}
      </fieldset>

      <div className="space-y-2">
        <button
          onClick={handlePreview}
          disabled={loading || !canContinue}
          className="min-h-10 rounded bg-action-primary px-4 py-2 text-sm font-medium text-action-primary-foreground disabled:opacity-60"
        >
          {loading ? 'Consultando currículo…' : 'Escolher como criar a prova'}
        </button>
        {!canContinue && (
          <p className="text-xs text-content-muted">Preencha segmento, professor responsável, ano e ao menos uma disciplina para continuar.</p>
        )}
      </div>
      </>}

      {choosingMode && <section className="space-y-4" aria-label="Modo de criação da prova">
        <div><h2 className="text-lg font-semibold">Como deseja criar a prova?</h2><p className="mt-1 text-sm text-content-secondary">{selectedSubjects.join(', ')} · {gradeYear}º ano</p><p className="mt-2 text-sm text-content-secondary">{recommendCreationMode(previews) === 'automatic' ? 'O planejamento tem habilidades BNCC ou ENEM mapeadas. Recomendamos a geração automática.' : 'Recomendamos a criação manual para selecionar as questões diretamente no banco.'}</p></div>
        <div className="grid gap-4 md:grid-cols-2">{(recommendCreationMode(previews) === 'automatic' ? ['automatic', 'manual'] : ['manual', 'automatic']).map((mode) => {
          const recommended = mode === recommendCreationMode(previews)
          const automatic = mode === 'automatic'
          const ModeIcon = automatic ? Sparkles : ClipboardPenLine
          return <div key={mode} className={`flex flex-col gap-4 rounded-xl border p-5 ${automatic ? 'border-status-success-border bg-status-success-surface' : 'border-status-info-border bg-status-info-surface'} ${recommended ? automatic ? 'ring-2 ring-status-success/40' : 'ring-2 ring-status-info/40' : ''}`}>
            <div className="flex items-start gap-3">
              <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${automatic ? 'bg-status-success/15 text-status-success-content' : 'bg-status-info/15 text-status-info-content'}`}><ModeIcon aria-hidden="true" className="size-6" /></span>
              <div className="space-y-2">
                <h3 className={`font-semibold ${automatic ? 'text-status-success-content' : 'text-status-info-content'}`}>{automatic ? 'Geração Automática' : 'Criação Manual'}</h3>
                {recommended && <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${automatic ? 'bg-status-success/15 text-status-success-content' : 'bg-status-info/15 text-status-info-content'}`}><BadgeCheck aria-hidden="true" className="size-4" />Recomendado para esta prova</span>}
              </div>
            </div>
            <p className="text-sm text-content-secondary">{mode === 'automatic' ? 'Monte a prova a partir do planejamento e das habilidades BNCC, usando o acervo e a IA conforme a composição escolhida.' : 'Escolha questões no banco externo, organize a ordem e acompanhe a classificação de Bloom e INEP a cada importação. Disponível mesmo sem BNCC mapeada.'}</p>
            {mode === 'manual' && selectedSubjects.length > 1 && <label className="block text-sm">Disciplina desta prova<select value={manualSubject} onChange={(event) => setManualSubject(event.target.value)} className="mt-1 w-full rounded border border-border bg-surface p-2">{selectedSubjects.map((subject) => <option key={subject}>{subject}</option>)}</select><span className="mt-1 block text-xs text-content-muted">Crie uma prova manual por disciplina.</span></label>}
            <button disabled={creatingManual} onClick={() => { if (mode === 'manual') void startManual(); else { setChoosingMode(false); setStep(2) } }} className={`mt-auto inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${automatic ? 'border-status-success-border bg-surface/70 text-status-success-content hover:bg-status-success/15' : 'border-status-info-border bg-surface/70 text-status-info-content hover:bg-status-info/15'}`}><ModeIcon aria-hidden="true" className="size-4 shrink-0" />{creatingManual && mode === 'manual' ? 'Criando rascunho…' : mode === 'manual' ? 'Iniciar criação manual' : 'Continuar com geração automática'}</button>
          </div>
        })}</div>
        <div className="space-y-2">{previews.map((preview) => <p key={preview.subject} className="text-xs text-content-secondary">{preview.subject}: {preview.error ? `não foi possível confirmar o mapeamento — ${preview.error}` : preview.data?.units.some((unit) => unit.habilidades.skills.length > 0) ? 'habilidades BNCC mapeadas no planejamento.' : 'sem habilidades BNCC mapeadas no planejamento.'}</p>)}</div>
        <button disabled={creatingManual} onClick={() => setChoosingMode(false)} className="min-h-10 rounded border border-border px-4 text-sm">Voltar aos dados da prova</button>
      </section>}

      {step === 2 && !enemArea && <p className="rounded border border-border p-4 text-sm text-content-secondary">Para importar questões das provas do ENEM, selecione Ensino Médio e uma única disciplina.</p>}
      {step === 2 && enemArea && (
        <div className="rounded border border-neutral-200 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-neutral-700">Banco de questões reais do ENEM</p>
              <p className="text-xs text-neutral-400">
                Questões selecionadas pelo conteúdo, pelas habilidades e pelo idioma do planejamento. Defina a quantidade ou busque para escolher os itens.
              </p>
            </div>
            <button
              onClick={handleBankSearch}
              disabled={bankLoading}
              className="min-h-10 rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium disabled:opacity-60"
            >
              {bankLoading ? 'Buscando…' : bankQuestions.length ? 'Buscar de novo pelo planejamento' : 'Buscar pelo planejamento'}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-xs font-medium text-neutral-500">Ano da prova ENEM
              <input type="number" min={1998} max={2100} placeholder="Todos os anos" value={bankYear} onChange={(e) => setBankYear(e.target.value)} className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-xs" />
            </label>
            <label className="text-xs font-medium text-neutral-500">Número da questão
              <input type="number" min={1} max={180} placeholder="Todas as questões" value={bankQuestionIndex} onChange={(e) => setBankQuestionIndex(e.target.value)} className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-xs" />
            </label>
            <label className="text-xs font-medium text-neutral-500">Buscar no enunciado
              <input type="search" placeholder="Ex.: glicose" value={bankQuery} onChange={(e) => setBankQuery(e.target.value)} className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-xs" />
            </label>
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

          {bankPlanningNote && <p role="status" className="mt-2 text-sm text-content-secondary">{bankPlanningNote}</p>}
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
                    disabled={bankLoading || (!bankSelected.has(q.id) && bankSelected.size >= totalCount)}
                    onChange={() => toggleBankQuestion(q.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">ENEM {q.year} · Questão {q.questionIndex}</span>
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
                    <p className="mt-1 text-neutral-600"><MathText text={q.preview} />…</p>
                  </div>
                </label>
              ))}
            </div>
          )}

          {bankSearched && !bankLoading && bankQuestions.length === 0 && <p className="mt-2 text-xs text-content-secondary">Nenhuma questão ENEM compatível com o planejamento e os filtros informados.</p>}

          {bankSelected.size > 0 && (
            <p className="mt-2 text-xs font-medium text-harmonia-green">{bankSelected.size} questão(ões) do banco selecionada(s)</p>
          )}
        </div>
      )}

      {step === 2 && <QuestionCompositionControls source={questionSource} onSourceChange={setQuestionSource} count={totalCount} onCountChange={changeTotalCount} bankCount={bankSelected.size} bankEnabled={Boolean(enemArea)} bankLoading={bankLoading} onBankCountChange={handleBankCountChange} onBankDraftChange={setBankCountPending} academicYear={academicYear} onYearChange={setAcademicYear} />}

      {step === 2 && singleSubject && previews[0]?.data && (
        <fieldset className="rounded border border-border bg-surface p-4">
          <legend className="px-1 text-sm font-medium">Matriz da avaliação</legend>
          <section aria-labelledby="tipo-questoes-title" className="mb-4 rounded-xl border border-harmonia-green/20 bg-harmonia-green/[0.035] p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 id="tipo-questoes-title" className="text-sm font-semibold text-content-primary">Formato das questões</h2>
                <p className="mt-0.5 text-xs text-content-muted">Deslize para definir a proporção da prova. À esquerda, mais alternativas; à direita, mais dissertativas.</p>
              </div>
              <span className="rounded-full bg-harmonia-green px-3 py-1 text-xs font-semibold text-white">{objectivePercentage}% alternativas</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={100 - objectivePercentage}
              onChange={(event) => setObjectivePercentage(100 - Number(event.target.value))}
              aria-label="Percentual de questões alternativas"
              aria-valuetext={`${objectivePercentage}% alternativas e ${100 - objectivePercentage}% dissertativas`}
              className="mt-5 h-2 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-harmonia-green via-harmonia-green/55 to-surface-muted accent-harmonia-green"
              style={{ direction: 'ltr' }}
            />
            <div className="mt-2 flex justify-between text-[11px] font-medium text-content-muted">
              <span>← 100% alternativas</span>
              <span>50% / 50%</span>
              <span>100% dissertativas →</span>
            </div>
            <p className="mt-3 text-xs text-content-secondary">
              Nesta prova: <span className="font-semibold text-harmonia-green">{effectiveObjectiveCount} alternativa(s)</span> e <span className="font-semibold text-content-primary">{totalCount - effectiveObjectiveCount} dissertativa(s)</span> no total. {questionSource === 'acervo' ? 'Buscaremos no acervo' : 'A IA gerará'} {aiObjectiveCount} alternativa(s) e {questionCount - aiObjectiveCount} dissertativa(s){bankSelected.size ? `, considerando as ${bankSelected.size} objetiva(s) do banco ENEM` : ''}.{effectiveObjectiveCount !== objectiveTarget && ' A proporção foi limitada porque as questões do banco são sempre objetivas.'}
            </p>
          </section>
          <section aria-labelledby="grafico-planejamento-title" className="rounded border border-border bg-surface-subtle/50 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 id="grafico-planejamento-title" className="text-sm font-semibold">Distribuição planejada por capítulo</h2>
                <p className="mt-0.5 text-xs text-content-muted">Arraste a barra (ou use as setas ←/→) para escolher o número de questões de cada capítulo. O total pode ficar acima ou abaixo do esperado; o botão Equilibrar distribui igualmente.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-harmonia-green">{contentPlanTotal} questão(ões) planejada(s)</span>
                <button
                  type="button"
                  onClick={balanceChapterCounts}
                  aria-label="Equilibrar a quantidade de questões entre os capítulos"
                  title="Distribuir as questões igualmente entre os capítulos"
                  className="rounded border border-border bg-surface px-2.5 py-1 text-xs font-medium text-content-secondary transition-colors hover:border-border-strong hover:bg-surface-subtle"
                >
                  Equilibrar
                </button>
              </div>
            </div>
            <ul className="mt-4 space-y-2">
              {previews[0].data.units.map((unit) => {
                const count = chapterCounts[unit.rowIndex] ?? 0
                const planned = contentPlan.find((item) => item.unitRowIndex === unit.rowIndex)?.questionCount ?? count
                const label = unit.tituloCapitulo || 'Capítulo sem título'
                return (
                  <li key={unit.rowIndex} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(220px,2fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-content-primary">{label}</p>
                      {unit.conteudo && <p className="line-clamp-1 text-[11px] text-content-muted">{unit.conteudo}</p>}
                    </div>
                    <div
                      role="slider"
                      tabIndex={0}
                      aria-label={`Número de questões de ${label}`}
                      aria-valuemin={0}
                      aria-valuemax={totalCount}
                      aria-valuenow={count}
                      aria-valuetext={`${count} questão(ões)`}
                      onPointerDown={(event) => {
                        draggingRowRef.current = unit.rowIndex
                        event.currentTarget.setPointerCapture(event.pointerId)
                        changeChapterCount(unit.rowIndex, questionsFromPointer(event.currentTarget, event.clientX, totalCount))
                      }}
                      onPointerMove={(event) => {
                        if (draggingRowRef.current !== unit.rowIndex) return
                        changeChapterCount(unit.rowIndex, questionsFromPointer(event.currentTarget, event.clientX, totalCount))
                      }}
                      onPointerUp={(event) => {
                        if (draggingRowRef.current !== unit.rowIndex) return
                        draggingRowRef.current = null
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
                      }}
                      onPointerCancel={() => { draggingRowRef.current = null }}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); changeChapterCount(unit.rowIndex, count + 1) }
                        else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); changeChapterCount(unit.rowIndex, count - 1) }
                        else if (event.key === 'Home') { event.preventDefault(); changeChapterCount(unit.rowIndex, 0) }
                        else if (event.key === 'End') { event.preventDefault(); changeChapterCount(unit.rowIndex, totalCount) }
                      }}
                      style={{ touchAction: 'none' }}
                      className="relative flex h-7 cursor-ew-resize items-center rounded bg-surface ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      <div className="relative h-full" style={{ width: `${totalCount > 0 ? (count / totalCount) * 100 : 0}%`, minWidth: count > 0 ? '1.75rem' : 0 }}>
                        <div className="flex h-full items-center justify-end rounded-l pr-2.5" style={{ backgroundColor: 'rgb(var(--color-action-primary))' }}>
                          {count > 0 && <span className="text-[11px] font-semibold leading-none text-action-primary-foreground">{count}</span>}
                        </div>
                        <span aria-hidden="true" className="absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 translate-x-1/2 rounded-full border-2 border-surface shadow-soft" style={{ backgroundColor: 'rgb(var(--color-action-primary))' }} />
                      </div>
                    </div>
                    <span className="justify-self-start rounded bg-harmonia-green/10 px-2 py-1 text-center text-xs font-semibold text-harmonia-green sm:justify-self-end">{planned} questão(ões)</span>
                  </li>
                )
              })}
            </ul>
          </section>
          <p className={`mt-3 text-xs ${contentPlanValid ? 'text-harmonia-green' : 'font-medium text-status-danger-content'}`}>
            Distribuição: {contentPlanTotal} de {totalCount} questões distribuídas, incluindo o ENEM.{!contentPlanValid && ' Ajuste a importância dos capítulos antes de continuar.'}
          </p>
        </fieldset>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-content-primary">{totalCount} questões por prova <span className="font-normal text-content-secondary">· {questionSource === 'acervo' ? 'Acervo com complemento por IA' : 'Geração com IA'}</span></p>
            <p className={`mt-1 text-xs ${totalValid ? 'text-content-muted' : 'text-status-danger'}`}>{bankSelected.size > 0 ? `${questionCount} da seleção + ${bankSelected.size} do banco ENEM. ` : ''}Escolha entre 10 e 30 questões.{selectedSubjects.length > 1 && ` A composição vale para as ${selectedSubjects.length} disciplinas.`}</p>
          </div>
          <div className="flex gap-3"><button onClick={() => setStep(1)} className="min-h-11 rounded-lg border border-border px-5 text-sm font-medium">Voltar</button><button onClick={() => setStep(3)} disabled={bankLoading || bankCountPending || !totalValid || !contentPlanValid} className="min-h-11 rounded-lg bg-harmonia-green px-6 text-sm font-semibold text-white disabled:opacity-40">Conferir prova →</button></div>
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
                ? `Conferência: ${questionCount} questão(ões) ${questionSource === 'acervo' ? 'do acervo, com complemento por IA se necessário' : 'geradas por IA'} e ${bankSelected.size} do banco ENEM.`
                : `Conferência: ${selectedSubjects.length} provas (${selectedSubjects.join(', ')}), cada uma com ${questionCount} questão(ões) ${questionSource === 'acervo' ? 'do acervo, com complemento por IA se necessário' : 'geradas por IA'}.`}{' '}
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
