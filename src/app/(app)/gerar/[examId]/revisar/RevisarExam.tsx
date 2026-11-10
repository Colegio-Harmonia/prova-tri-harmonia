'use client'

import { questionInepLabel } from '@/lib/exams/questionInepLabel'

import { LazyMathText as MathText } from '@/components/ui/LazyMathText'
import { originalAcervoMedia, originalAcervoMediaUrl, hasOnlyInlineAcervoMedia } from '@/lib/exams/acervoMedia'
import { AcervoText } from '@/components/ui/AcervoText'

import { questionProvenanceTags, questionOriginLabel, isOriginalBankImage, isQuestionImageApproved } from '@/lib/exams/questionOrigin'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { IMAGE_ALTERNATIVE_PLACEHOLDER } from '@/lib/math/latexSegments'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { ReviewProgress } from '@/features/assessments/components/ReviewProgress'
import AddQuestionModal from './AddQuestionModal'
import PublishToClassroom from './PublishToClassroom'
import ActivityClassroomResults from './ActivityClassroomResults'
import SheetAssignmentsPanel from './SheetAssignmentsPanel'
import { downloadSheetAssignments } from './downloadSheetAssignments'
import { canFinalizeOwnActivity, canMarkOwnActivityApplied } from '@/lib/exams/activityWorkflow'
import { questionImageUrl } from '@/lib/images/questionImageUrl'
import type { IllustrationAnalysis, IllustrationRecommendation } from '@/lib/illustrations/recommendations'
import { diagnosticsForQuestion, humanReviewDiagnostics } from '@/lib/exams/qualityDiagnostics'


function SupportText({ text }: { text: string }) {
  const lines = text.split('\n')
  const dividerIndex = lines.findIndex((line, index) => index > 0 && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
  if (dividerIndex <= 0) return <details className="mt-2 rounded border border-border bg-surface-subtle p-2 text-content-secondary"><summary className="cursor-pointer list-none text-xs font-medium">ⓘ Texto de apoio obrigatório</summary><p className="mt-2 whitespace-pre-wrap"><MathText text={text} /></p></details>
  const header = lines[dividerIndex - 1].split('|').map((cell) => cell.trim()).filter(Boolean)
  const rows = lines.slice(dividerIndex + 1).filter((line) => line.includes('|')).map((line) => line.split('|').map((cell) => cell.trim()).filter(Boolean))
  if (header.length < 2 || !rows.length || rows.some((row) => row.length !== header.length)) return <details className="mt-2 rounded border border-border bg-surface-subtle p-2 text-content-secondary"><summary className="cursor-pointer list-none text-xs font-medium">ⓘ Texto de apoio obrigatório</summary><p className="mt-2 whitespace-pre-wrap"><MathText text={text} /></p></details>
  const before = lines.slice(0, dividerIndex - 1).join('\n').trim()
  const after = lines.slice(dividerIndex + 1 + rows.length).join('\n').trim()
  return <details className="mt-2 rounded border border-border bg-surface-subtle p-2 text-content-secondary">
    <summary className="cursor-pointer list-none text-xs font-medium">ⓘ Texto de apoio obrigatório</summary>
    <div className="mt-2 space-y-2">
    {before && <p><MathText text={before} /></p>}
    <div className="overflow-x-auto rounded border border-border"><table className="min-w-full text-left text-sm"><thead className="bg-surface-subtle"> <tr>{header.map((cell, index) => <th key={index} className="border-b border-border px-3 py-2 font-medium"><MathText text={cell} /></th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-border/70 last:border-0">{row.map((cell, index) => <td key={index} className="px-3 py-2"><MathText text={cell} /></td>)}</tr>)}</tbody></table></div>
    {after && <p><MathText text={after} /></p>}
    </div>
  </details>
}

type ExamRow = {
  id: number
  segment: string
  gradeYear: number
  subject: string
  bimester: number | null
  status: string
  examKind: 'prova' | 'reforco_enem' | 'atividade'
  createdBy: number
  assignedTo: number | null
  generationPayload: ExamGenerationResult
  unmappedWarnings: string[] | null
  assigneeName: string | null
  assigneeEmail: string | null
  provaDocUrl: string | null
  gabaritoDocUrl: string | null
  mapaDocUrl: string | null
  reviewReadyNotifiedAt: string | null
  classroomCourseId: string | null
  classroomCourseWorkId: string | null
  formEditUrl: string | null
}

type UserOption = { id: number; name: string; email: string; role: string }
type Action = 'atribuir' | 'confirmar_prova_parcial' | 'iniciar_revisao' | 'aprovar_prova' | 'concluir_revisao' | 'aprovar' | 'marcar_impresso' | 'marcar_aplicado' | 'marcar_corrigido' | 'finalizar_atividade' | 'finalizar_atividade_parcial' | 'marcar_atividade_aplicada'

const IMAGE_SOURCE_LABELS: Record<string, string> = {
  busca: 'Encontrada (Wikimedia Commons)',
  grafico: 'Gráfico renderizado a partir dos dados da questão',
  diagrama: 'Diagrama matemático renderizado a partir dos dados da questão',
  quimica: 'Estrutura química renderizada a partir da fórmula da questão',
  gerada: 'Gerada por IA',
  importado: 'Importada de link colado pelo professor',
  enem: 'Original da prova do ENEM (mesma imagem aplicada na época)',
}
const STATUS_LABELS: Record<string, string> = {
  rascunho: 'Rascunho',
  atribuido: 'Atribuído',
  em_andamento: 'Em andamento',
  em_revisao: 'Em aprovação',
  revisao_concluida: 'Revisão concluída',
  aprovado: 'Aprovado',
  impresso: 'Impresso',
  aplicado: 'Aplicado',
  parcialmente_corrigida: 'Parcialmente corrigida',
  corrigido: 'Corrigido',
}

const STATUS_COLORS: Record<string, string> = {
  rascunho: 'bg-neutral-100 text-neutral-600',
  atribuido: 'bg-blue-50 text-blue-700',
  em_andamento: 'bg-amber-50 text-amber-700',
  em_revisao: 'bg-amber-50 text-amber-700',
  revisao_concluida: 'bg-teal-50 text-teal-700',
  aprovado: 'bg-harmonia-green/10 text-harmonia-green',
  impresso: 'bg-neutral-700 text-white',
  aplicado: 'bg-violet-50 text-violet-700',
  parcialmente_corrigida: 'bg-violet-50 text-violet-700',
  corrigido: 'bg-neutral-900 text-white',
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[status] ?? 'bg-neutral-100'}`}>{STATUS_LABELS[status] ?? status}</span>
}

function reviewPendingItems(payload: ExamGenerationResult): string[] {
  return payload.questions.flatMap((question) => {
    const pending: string[] = []
    if (question.review?.adequacy !== 'adequada') pending.push(`Questão ${question.number} não aceita`)
    if (question.image && !isQuestionImageApproved(question)) pending.push(`Imagem da questão ${question.number} não aprovada`)
    return pending
  })
}

export default function RevisarExam({ examId, currentUserRole, currentUserId }: { examId: number; currentUserRole: string; currentUserId: number | null }) {
  const [exam, setExam] = useState<ExamRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [users, setUsers] = useState<UserOption[]>([])
  const [selectedAssignee, setSelectedAssignee] = useState<number | ''>('')

  const [regeneratingQuestion, setRegeneratingQuestion] = useState<number | null>(null)
  const [savingReview, setSavingReview] = useState<number | null>(null)
  const [requestingImage, setRequestingImage] = useState<number | null>(null)
  const [renderingIllustration, setRenderingIllustration] = useState<number | null>(null)
  const [illustrationAnalyses, setIllustrationAnalyses] = useState<Record<number, IllustrationAnalysis>>({})
  const [analyzingIllustrations, setAnalyzingIllustrations] = useState<number | null>(null)
  const [imageConfirmation, setImageConfirmation] = useState<number | null>(null)
  const [actionError, setActionError] = useState<Record<number, string>>({})
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [expandedImageQuestion, setExpandedImageQuestion] = useState<number | null>(null)
  const [restoringImage, setRestoringImage] = useState<string | null>(null)
  const [qualityReportOpen, setQualityReportOpen] = useState(false)
  const [addingQuestion, setAddingQuestion] = useState(false)

  const isCoordenacao = isStaffSuperuser(currentUserRole)
  const canAssignFormalExam = Boolean(
    exam?.examKind === 'prova' &&
    exam.status === 'rascunho' &&
    (isCoordenacao || exam.createdBy === currentUserId),
  )

  function patchQuestion(questionNumber: number, patch: Record<string, unknown>) {
    setExam((current) => {
      if (!current) return current
      return {
        ...current,
        generationPayload: {
          ...current.generationPayload,
          questions: current.generationPayload.questions.map((question) => question.number === questionNumber ? { ...question, ...patch } : question),
        },
      }
    })
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/exams/${examId}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao carregar prova.')
        return
      }
      setExam(data.exam)
    } catch {
      setError('Falha de rede ao carregar prova.')
    } finally {
      setLoading(false)
    }
  }, [examId])

  const handleQuestionAdded = useCallback(() => {
    setActionMessage('A questão foi adicionada e está pronta para revisão.')
    void load()
  }, [load])


  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!canAssignFormalExam) return
    fetch('/api/users')
      .then((res) => res.json())
      .then((data) => {
        setUsers(data.users ?? [])
        if (!isCoordenacao && currentUserId) setSelectedAssignee(currentUserId)
      })
      .catch(() => {})
  }, [canAssignFormalExam, currentUserId, isCoordenacao])

  async function handleRegenerate() {
    setRegenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/exams/${examId}/regenerate`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao regenerar.')
        return
      }
      setActionMessage('Andamento atualizado. A próxima ação disponível foi recalculada.')
      await load()
    } catch {
      setError('Falha de rede ao regenerar.')
    } finally {
      setRegenerating(false)
    }
  }

  async function handleToggleImage(questionNumber: number, approved: boolean) {
    setError(null)
    try {
      const res = await fetch(`/api/exams/${examId}/toggle-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionNumber, approved }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao atualizar imagem.')
        return
      }
      setExam((current) => {
        if (!current) return current
        const question = current.generationPayload.questions.find((item) => item.number === questionNumber)
        if (!question?.image) return current
        return {
          ...current,
          generationPayload: { ...current.generationPayload, questions: current.generationPayload.questions.map((item) => item.number === questionNumber ? { ...item, image: { ...question.image!, approved } } : item) },
        }
      })
    } catch {
      setError('Falha de rede ao atualizar imagem.')
    }
  }

  async function handleRemoveImage(questionNumber: number) {
    setError(null)
    try {
      const res = await fetch(`/api/exams/${examId}/toggle-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionNumber, remove: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao remover imagem.')
        return
      }
      setExam((current) => {
        if (!current) return current
        return {
          ...current,
          generationPayload: {
            ...current.generationPayload,
            questions: current.generationPayload.questions.map((item) => item.number === questionNumber ? { ...item, image: null, needsImage: false, imageQuery: null } : item),
          },
        }
      })
    } catch {
      setError('Falha de rede ao remover imagem.')
    }
  }

  async function handleRestoreImage(questionNumber: number, driveFileId: string) {
    setRestoringImage(driveFileId)
    setActionError((previous) => ({ ...previous, [questionNumber]: '' }))
    try {
      const res = await fetch(`/api/exams/${examId}/restore-image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionNumber, driveFileId }) })
      const data = await res.json()
      if (!res.ok) { setActionError((previous) => ({ ...previous, [questionNumber]: data.error ?? 'Não foi possível restaurar a versão.' })); return }
      patchQuestion(questionNumber, { image: data.image, imageHistory: data.imageHistory, imageAuditLog: data.imageAuditLog, needsImage: true })
      setActionMessage(`A versão anterior da imagem da questão ${questionNumber} foi restaurada e aguarda nova aprovação.`)
    } catch { setActionError((previous) => ({ ...previous, [questionNumber]: 'Falha de rede ao restaurar a versão.' })) } finally { setRestoringImage(null) }
  }

  async function handleReviewNote(
    questionNumber: number,
    patch: { adequacy?: 'adequada' | 'inadequada' | null; comment?: string | null },
  ) {
    setSavingReview(questionNumber)
    setActionError((prev) => ({ ...prev, [questionNumber]: '' }))
    try {
      const res = await fetch(`/api/exams/${examId}/review-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionNumber, ...patch }),
      })
      const data = await res.json()
      if (!res.ok) {
        setActionError((prev) => ({ ...prev, [questionNumber]: data.error ?? 'Erro ao salvar revisão.' }))
        return
      }
      patchQuestion(questionNumber, { review: data.review })
    } catch {
      setActionError((prev) => ({ ...prev, [questionNumber]: 'Falha de rede ao salvar revisão.' }))
    } finally {
      setSavingReview(null)
    }
  }

  async function handleAcceptQuestion(questionNumber: number) {
    setSavingReview(questionNumber)
    setActionError((prev) => ({ ...prev, [questionNumber]: '' }))
    try {
      const res = await fetch(`/api/exams/${examId}/review-note`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionNumber, adequacy: 'adequada' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setActionError((prev) => ({ ...prev, [questionNumber]: data.error ?? 'Erro ao aceitar questão.' }))
        return
      }
      patchQuestion(questionNumber, { review: data.review })
    } catch {
      setActionError((prev) => ({ ...prev, [questionNumber]: 'Falha de rede ao aceitar questão.' }))
    } finally {
      setSavingReview(null)
    }
  }

  async function handleRegenerateQuestion(questionNumber: number, sourcePreference: 'ia' | 'acervo' = 'ia') {
    setRegeneratingQuestion(questionNumber)
    setActionError((prev) => ({ ...prev, [questionNumber]: '' }))
    try {
      const res = await fetch(`/api/exams/${examId}/regenerate-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionNumber, sourcePreference }),
      })
      const data = await res.json()
      if (!res.ok) {
        setActionError((prev) => ({ ...prev, [questionNumber]: data.error ?? 'Erro ao trocar questão.' }))
        return
      }
      await load()
    } catch {
      setActionError((prev) => ({ ...prev, [questionNumber]: 'Falha de rede ao trocar questão.' }))
    } finally {
      setRegeneratingQuestion(null)
    }
  }

  async function handleRepairQuestion(questionNumber: number) {
    setRegeneratingQuestion(questionNumber)
    setActionError((prev) => ({ ...prev, [questionNumber]: '' }))
    try {
      const res = await fetch(`/api/exams/${examId}/regenerate-question`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionNumber, repairOnly: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        setActionError((prev) => ({ ...prev, [questionNumber]: data.error ?? 'Não foi possível corrigir a questão automaticamente.' }))
        return
      }
      setActionMessage(`Questão ${questionNumber} corrigida automaticamente e reenviada ao controle de qualidade.`)
      await load()
    } catch {
      setActionError((prev) => ({ ...prev, [questionNumber]: 'Falha de rede ao corrigir a questão.' }))
    } finally {
      setRegeneratingQuestion(null)
    }
  }

  async function handleRequestImage(questionNumber: number, force = false) {
    if (force) setImageConfirmation(null)
    setRequestingImage(questionNumber)
    setActionError((prev) => ({ ...prev, [questionNumber]: '' }))
    try {
      const res = await fetch(`/api/exams/${examId}/request-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionNumber, force }),
      })
      const data = await res.json()
      if (data.needsConfirmation) {
        setImageConfirmation(questionNumber)
        return
      }
      if (!res.ok) {
        setActionError((prev) => ({ ...prev, [questionNumber]: data.error ?? 'Erro ao buscar imagem.' }))
        return
      }
      setImageConfirmation(null)
      patchQuestion(questionNumber, { needsImage: true, image: data.image })
    } catch {
      setActionError((prev) => ({ ...prev, [questionNumber]: 'Falha de rede ao buscar imagem.' }))
    } finally {
      setRequestingImage(null)
    }
  }

  async function handleAnalyzeIllustrations(questionNumber: number) {
    setAnalyzingIllustrations(questionNumber); setActionError((previous) => ({ ...previous, [questionNumber]: '' }))
    try {
      const res = await fetch(`/api/exams/${examId}/recommend-illustrations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionNumber }) })
      const data = await res.json()
      if (!res.ok) { setActionError((previous) => ({ ...previous, [questionNumber]: data.error ?? 'Não foi possível analisar a questão.' })); return }
      if (!data.analysis) { setActionError((previous) => ({ ...previous, [questionNumber]: 'A análise visual retornou um formato inválido.' })); return }
      setIllustrationAnalyses((previous) => ({ ...previous, [questionNumber]: data.analysis }))
    } catch { setActionError((previous) => ({ ...previous, [questionNumber]: 'Falha de rede ao analisar a questão.' })) } finally { setAnalyzingIllustrations(null) }
  }

  async function handleGenerateRecommendedIllustration(questionNumber: number, recommendation: IllustrationRecommendation) {
    setRenderingIllustration(questionNumber); setActionError((previous) => ({ ...previous, [questionNumber]: '' }))
    try {
      const res = await fetch(`/api/exams/${examId}/render-illustration`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionNumber, generator: recommendation.generator, parameters: recommendation.parameters }) })
      const data = await res.json()
      if (!res.ok) { setActionError((previous) => ({ ...previous, [questionNumber]: data.error ?? 'Não foi possível gerar a ilustração.' })); return }
      patchQuestion(questionNumber, { needsImage: true, image: data.image })
      setIllustrationAnalyses((previous) => { const next = { ...previous }; delete next[questionNumber]; return next })
    } catch { setActionError((previous) => ({ ...previous, [questionNumber]: 'Falha de rede ao gerar a ilustração.' })) } finally { setRenderingIllustration(null) }
  }


  async function handleTransition(action: Action, assignedTo?: number, printWindow?: Window | null) {
    setTransitioning(true)
    setError(null)
    let postTransitionError: string | null = null
    try {
      const res = await fetch(`/api/exams/${examId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(assignedTo ? { assignedTo } : {}) }),
      })
      const data = await res.json()
      if (!res.ok) {
        printWindow?.close()
        setError(data.message ?? data.error ?? 'Erro ao atualizar status.')
        return
      }
      if (action === 'marcar_impresso' && Array.isArray(data.readySheetAssignmentIds) && data.readySheetAssignmentIds.length > 0) {
        try {
          await downloadSheetAssignments(examId, data.readySheetAssignmentIds)
          setActionMessage(`${data.readySheetAssignmentIds.length} ${data.readySheetAssignmentIds.length === 1 ? 'cartão-resposta foi baixado' : 'cartões-resposta foram baixados'} para impressão.`)
        } catch (reason) {
          const detail = reason instanceof Error ? reason.message : 'Não foi possível baixar os cartões-resposta.'
          postTransitionError = `A prova foi marcada como impressa, mas ${detail} Você pode baixar as fichas na seção “Folhas de resposta”.`
        }
      } else if (action === 'marcar_impresso' && exam?.classroomCourseId) {
        setActionMessage('A prova foi marcada como impressa. Não há novos cartões-resposta para baixar.')
      }
      await load()
      if (postTransitionError) setError(postTransitionError)
      if (action === 'marcar_impresso' && exam?.provaDocUrl && printWindow) {
        printWindow.location.assign(exam.provaDocUrl)
      }
    } catch {
      printWindow?.close()
      setError('Falha de rede ao atualizar status.')
    } finally {
      setTransitioning(false)
    }
  }

  function handlePrint() {
    // Abrimos uma aba vazia no gesto do clique para que o navegador não
    // bloqueie a prova. Ela só recebe o documento depois de o servidor
    // preparar os cartões; em caso de falha, a aba é fechada.
    const printWindow = exam?.provaDocUrl ? window.open('', '_blank') : null
    void handleTransition('marcar_impresso', undefined, printWindow)
  }

  if (loading) return <p className="text-sm text-neutral-500">Carregando…</p>
  if (error && !exam) return <p className="text-sm text-red-600">{error}</p>
  if (!exam) return null

  const payload = exam.generationPayload
  const usesWholeExamEngine = payload.metadata.generationEngine === 'whole-exam-v1'
  const finalQualityReport = payload.metadata.qualityTest?.reports?.at(-1)
  const jevPendingCount = usesWholeExamEngine ? 0 : payload.questions.filter((question) => question.source !== 'enem_bank' && !finalQualityReport?.results.find((result) => result.questionNumber === question.number)?.approved).length
  const qualityResults = [...(finalQualityReport?.results ?? [])].filter((result) => result.auditStatus !== 'jev_unavailable' && payload.questions.find((q) => q.number === result.questionNumber)?.source !== 'enem_bank')
    .sort((a, b) => a.questionNumber - b.questionNumber)
  const reviewEditable =
    exam.status === 'rascunho' || exam.status === 'atribuido' || exam.status === 'em_andamento' || exam.status === 'revisao_concluida' || exam.status === 'em_revisao'
  const isAssignee = exam.assignedTo != null && exam.assignedTo === currentUserId
  const isOwnActivity = exam.examKind !== 'prova' && exam.createdBy === currentUserId
  const canActOnOwnStep = isCoordenacao || isAssignee || isOwnActivity
  const canAddQuestion = !usesWholeExamEngine && exam.examKind === 'prova' && ['rascunho', 'atribuido', 'em_revisao', 'revisao_concluida'].includes(exam.status) && (canActOnOwnStep || exam.createdBy === currentUserId)
  const canFinalizeActivity = canFinalizeOwnActivity(exam, currentUserId, isCoordenacao)
  const canMarkActivityApplied = canMarkOwnActivityApplied(exam, currentUserId, isCoordenacao)
  const pendingReviewItems = reviewPendingItems(payload)
  const generationProgress = payload.metadata.generationProgress
  const partialGenerationProgress = generationProgress?.complete === false ? generationProgress : null
  const isPartialGeneration = Boolean(partialGenerationProgress && !partialGenerationProgress.acceptedReducedQuestionCount)
  const humanReviewItems = humanReviewDiagnostics(payload).filter((item) => !item.acknowledged)
  const diagnosticsByQuestion = new Map(payload.questions.map((question) => [question.number, diagnosticsForQuestion(payload, question.number)]))
  const hasFixedApprovalAction =
    (canActOnOwnStep && exam.status === 'em_revisao') ||
    (isCoordenacao && exam.status === 'revisao_concluida')

  return (
    <div className={`space-y-6 ${hasFixedApprovalAction ? 'pb-28' : ''}`}>
      <div aria-live="polite" className="sr-only">{actionMessage}</div>
      <div className="space-y-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">
              {exam.subject} — {exam.gradeYear}º ano {exam.bimester ? `— ${exam.bimester}º bimestre` : ''}
            </h1>
            <StatusBadge status={exam.status} />
          </div>
          <p className="text-sm text-neutral-500">
            {payload.metadata.objectiveCount} objetivas + {payload.metadata.discursiveCount} descritivas
            {exam.assigneeName && ` · ${exam.examKind === 'prova' ? 'atribuída a' : 'responsável'} ${exam.assigneeName}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canAddQuestion && (
            <button onClick={() => setAddingQuestion(true)} className="rounded border border-harmonia-green px-4 py-2 text-sm font-medium text-harmonia-green">
              + Adicionar questão
            </button>
          )}
          {exam.status === 'rascunho' && (
            <button onClick={handleRegenerate} disabled={regenerating} className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-60">
              {regenerating ? 'Regenerando…' : 'Regenerar'}
            </button>
          )}
          {usesWholeExamEngine && exam.examKind === 'prova' && (canActOnOwnStep || exam.createdBy === currentUserId) && (
            <p className="w-full text-xs text-content-secondary">As questões desta prova foram geradas como um conjunto; para mudar a quantidade, inicie uma nova geração com o total desejado.</p>
          )}

          {partialGenerationProgress && (
            <div role="status" className="w-full rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-semibold">{partialGenerationProgress.acceptedReducedQuestionCount ? 'Quantidade reduzida aceita' : 'Prova parcial'}: {payload.questions.length} de {partialGenerationProgress.requestedQuestionCount} questões geradas.</p>
              <p className="mt-1">As questões aprovadas foram preservadas. Pendentes: {partialGenerationProgress.pendingQuestionNumbers.length ? partialGenerationProgress.pendingQuestionNumbers.join(', ') : 'questões do banco selecionado'}.</p>
              {partialGenerationProgress.pendingReasons && Object.entries(partialGenerationProgress.pendingReasons).length > 0 && <ul className="mt-2 list-inside list-disc space-y-1">{Object.entries(partialGenerationProgress.pendingReasons).map(([number, reason]) => <li key={number}>Questão {number}: {reason}</li>)}</ul>}
              <p className="mt-1">{partialGenerationProgress.acceptedReducedQuestionCount ? 'Esta avaliação segue com quantidade menor que a solicitada, conforme aceite registrado.' : `Revise o conteúdo. Para seguir com essa quantidade reduzida, confirme explicitamente ao ${exam.examKind === 'prova' ? 'atribuir' : 'finalizar'}.`}</p>
            </div>
          )}

          {payload.questions.length === 0 && exam.examKind === 'prova' && (
            <div role="status" className="w-full rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              A prova foi salva sem questões aprovadas. Gere pelo menos uma questão antes de atribuir.
            </div>
          )}

          {canAssignFormalExam && (
            <div className="flex items-center gap-2">
              <select
                value={selectedAssignee}
                onChange={(e) => setSelectedAssignee(e.target.value ? Number(e.target.value) : '')}
                className="rounded border border-neutral-300 px-2 py-2 text-sm"
              >
                <option value="">Atribuir a…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                ))}
              </select>
              <button
                onClick={() => selectedAssignee && handleTransition(isPartialGeneration ? 'confirmar_prova_parcial' : 'atribuir', selectedAssignee)}
                disabled={transitioning || !selectedAssignee || payload.questions.length === 0}
                className="rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {isPartialGeneration ? 'Aceitar quantidade reduzida e atribuir' : 'Atribuir'}
              </button>
            </div>
          )}

          {canFinalizeActivity && (
            <button
              onClick={() => handleTransition(isPartialGeneration ? 'finalizar_atividade_parcial' : 'finalizar_atividade')}
              disabled={transitioning}
              className="min-h-10 whitespace-nowrap rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {transitioning ? 'Finalizando e gerando documentos…' : isPartialGeneration ? 'Aceitar quantidade reduzida e finalizar' : humanReviewItems.length ? 'Revisar pendências antes de finalizar' : 'Finalizar atividade e gerar documentos'}
            </button>
          )}

          {canActOnOwnStep && exam.status === 'atribuido' && (
            <button
              onClick={() => handleTransition('iniciar_revisao')}
              disabled={transitioning}
              className="rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Iniciar aprovação
            </button>
          )}

          {exam.examKind === 'prova' && (
            <button
              onClick={handlePrint}
              disabled={transitioning || !isCoordenacao || exam.status !== 'aprovado'}
              title={exam.status === 'aprovado' ? undefined : ['impresso', 'aplicado', 'parcialmente_corrigida', 'corrigido'].includes(exam.status) ? 'A prova já foi marcada como impressa.' : 'A impressão é liberada após a aprovação da prova.'}
              className="rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {transitioning ? 'Preparando impressão…' : exam.classroomCourseId ? 'Imprimir prova e cartões' : 'Imprimir prova'}
            </button>
          )}

          {canMarkActivityApplied && (
            <button
              onClick={() => handleTransition('marcar_atividade_aplicada')}
              disabled={transitioning}
              className="rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Marcar atividade como aplicada
            </button>
          )}

          {canActOnOwnStep && exam.status === 'impresso' && (
            <button
              onClick={() => handleTransition('marcar_aplicado')}
              disabled={transitioning}
              className="rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Marcar como aplicado
            </button>
          )}

          {exam.examKind === 'prova' && canActOnOwnStep && ['aplicado', 'parcialmente_corrigida', 'corrigido'].includes(exam.status) && (
            <Link
              href={`/gerar/${examId}/corrigir`}
              className="min-h-10 whitespace-nowrap rounded border border-harmonia-green px-4 py-2 text-sm font-medium text-harmonia-green"
            >
              Corrigir provas dos alunos
            </Link>
          )}

          {['reforco_enem', 'atividade'].includes(exam.examKind) && ['aprovado', 'impresso', 'aplicado', 'corrigido'].includes(exam.status) && (
            <PublishToClassroom
              examId={exam.id}
              linkedCourseId={exam.classroomCourseId}
              alreadyPublished={Boolean(exam.classroomCourseWorkId)}
              formEditUrl={exam.formEditUrl}
              activityKind={exam.examKind}
            />
          )}

          {['aprovado', 'impresso', 'aplicado', 'corrigido'].includes(exam.status) && (
            <Link
              href={`/gerar/${examId}/adaptar`}
              className="rounded border border-harmonia-green px-4 py-2 text-sm font-medium text-harmonia-green"
            >
              Adaptação de Atividade
            </Link>
          )}
        </div>
      </div>

      <ReviewProgress status={exam.status} examKind={exam.examKind} />

      {error && <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {humanReviewItems.length > 0 && (
        <section className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" aria-label="Pendências de revisão humana">
          <p className="font-semibold">Atenção: {humanReviewItems.length} questão(ões) exigem revisão humana antes da finalização.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {humanReviewItems.map((item) => <li key={`${item.questionNumber}-${item.diagnostic.code}`}><a href={`#question-${item.questionNumber}`} className="font-medium underline">Questão {item.questionNumber}</a>: {item.diagnostic.message}</li>)}
          </ul>
        </section>
      )}

      {exam.examKind === 'prova' && ['aprovado', 'impresso'].includes(exam.status) && (
        <SheetAssignmentsPanel
          examId={examId}
          classroomCourseId={exam.classroomCourseId}
          onCourseLinked={load}
        />
      )}

      {exam.examKind === 'atividade' && Boolean(exam.classroomCourseWorkId) && (
        <ActivityClassroomResults examId={examId} />
      )}

      {qualityResults.length > 0 && <button type="button" onClick={() => setQualityReportOpen(true)} className="text-xs font-medium text-harmonia-green underline">Ver conferência das questões</button>}

      {qualityReportOpen && finalQualityReport && <div role="dialog" aria-modal="true" aria-labelledby="quality-report-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setQualityReportOpen(false)}>
        <section className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-surface p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-4">
            <div><h2 id="quality-report-title" className="text-lg font-semibold">Relatório detalhado do teste de qualidade</h2><p className="mt-1 text-sm text-content-secondary">Resultado da auditoria inicial. Questões pendentes mantêm o rascunho para revisão e nova validação.</p></div>
            <button type="button" onClick={() => setQualityReportOpen(false)} className="rounded border border-border px-3 py-1.5 text-sm">Fechar</button>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {qualityResults.map((result) => <article key={result.questionNumber} className={`rounded-lg border p-3 ${result.approved ? 'border-harmonia-green/30 bg-harmonia-green/5' : 'border-amber-300 bg-amber-50'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">Questão {result.questionNumber}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${result.approved ? 'bg-harmonia-green/10 text-harmonia-green' : 'bg-amber-100 text-amber-900'}`}>
                  {result.approved ? (result.auditStatus === 'corrected_without_reaudit' ? 'Corrigida sem reauditoria' : result.auditStatus === 'correction_unavailable' ? 'Correção não aplicada; incluída sem reauditoria' : 'Aprovada pelo Jev') : result.auditStatus === 'jev_unavailable' ? 'Jev indisponível; rascunho preservado' : 'Pendente de revisão'}
                </span>
              </div>
              {result.verdictReason && <p className="mt-2 text-sm text-content-secondary">{result.verdictReason}</p>}
              {result.answerKeyAudit && <div className="mt-3 rounded bg-surface p-2 text-xs"><p className="font-medium">Conferência independente do gabarito</p><p className="mt-0.5 text-content-secondary">{result.answerKeyAudit.evidence}</p></div>}
              {result.checks?.length ? <ul className="mt-3 space-y-2 text-xs">{result.checks.map((check, checkIndex) => <li key={checkIndex} className="rounded bg-surface p-2"><p className="font-medium">{check.criterion.replace(/_/g, ' ')} · {check.status}</p><p className="mt-0.5 text-content-secondary">{check.evidence}</p></li>)}</ul> : null}
              {result.issues.map((issue, issueIndex) => <p key={issueIndex} className="mt-2 text-xs text-content-secondary">{issue.severity === 'bloqueante' ? 'Pendência' : 'Atenção'}: {issue.reason}</p>)}
            </article>)}
          </div>
          {!qualityResults.length && <p className="mt-5 text-sm text-content-secondary">Nenhum resultado de qualidade disponível.</p>}
        </section>
      </div>}

      {['aprovado', 'impresso', 'aplicado', 'corrigido'].includes(exam.status) && (
        <div className="rounded border border-harmonia-green/30 bg-harmonia-green/5 p-4 text-sm">
          <p className="font-medium text-harmonia-green">Documentos:</p>
          <ul className="mt-1 list-disc pl-5">
            {exam.provaDocUrl && <li><a className="underline" href={exam.provaDocUrl} target="_blank" rel="noreferrer">{exam.examKind === 'prova' ? 'Prova' : 'Atividade'}</a></li>}
            {exam.gabaritoDocUrl && <li><a className="underline" href={exam.gabaritoDocUrl} target="_blank" rel="noreferrer">{exam.examKind === 'reforco_enem' ? 'Gabarito comentado' : exam.examKind === 'atividade' ? 'Gabarito da atividade' : 'Gabarito'}</a></li>}
            {exam.mapaDocUrl && <li><a className="underline" href={exam.mapaDocUrl} target="_blank" rel="noreferrer">{exam.examKind === 'prova' ? 'Mapa da prova' : 'Mapa da atividade'}</a></li>}
          </ul>
        </div>
      )}

      <div className="space-y-6">
        {payload.questions.map((q) => (
          <article id={`question-${q.number}`} key={q.number} className="relative scroll-mt-6 overflow-hidden rounded-xl border border-border bg-surface p-5 text-sm text-content-primary shadow-sm">
            <div className="absolute inset-y-0 left-0 w-1 bg-harmonia-green/70" />
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-harmonia-green px-2.5 py-1 font-semibold text-white">Questão {q.number}</span>
              <span className="rounded bg-violet-50 px-2 py-0.5 font-medium text-violet-700">{questionOriginLabel(q)}</span>
              {questionProvenanceTags(q).map((label) => <span key={label} className="rounded bg-surface-subtle px-2 py-0.5 text-content-secondary">{label}</span>)}
              {q.source === 'enem_bank' ? (
                <span className="rounded bg-violet-50 px-2 py-0.5 font-medium text-violet-700">
                  Questão real — ENEM {q.enemBankRef?.year}
                </span>
              ) : <span className="rounded bg-surface-subtle px-2 py-0.5 text-content-secondary">{q.type}</span>}
              <span title={q.bnccAssessment?.errorCode === 'no_official_candidates' ? 'O catálogo oficial não oferece habilidades para esta disciplina e este ano.' : q.bnccAssessment?.status === 'no_match' ? `Nenhuma habilidade ultrapassou ${q.bnccAssessment.thresholdPercent}% de alinhamento.` : undefined} className={`rounded px-2 py-0.5 ${q.bnccCodes.length ? 'bg-harmonia-green/10 text-harmonia-green' : 'bg-surface-subtle text-content-secondary'}`}>
                {q.bnccCodes.length ? q.bnccCodes.join(', ') : 'BNCC não mapeada'}
              </span>
              <span className="rounded bg-surface-subtle px-2 py-0.5 text-content-secondary">Bloom: {q.bloomLevel}</span>
              <span className="rounded bg-surface-subtle px-2 py-0.5 text-content-secondary">
                {questionInepLabel(q)}
              </span>
            </div>

            {q.acervoFallbackReason && <p className="mt-2 text-xs text-content-secondary">{q.acervoFallbackReason}</p>}
            {q.plannedEnemSkill && <p className="mt-2 text-xs text-content-secondary">Alvo do planejamento: <strong>{q.plannedEnemSkill.code}</strong> — {q.plannedEnemSkill.description}</p>}
            {q.planningAlignment && <p className="mt-2 text-xs text-content-secondary">
              Aderência conferida na geração: <strong>{q.planningAlignment.status === 'aligned' ? 'compatível' : q.planningAlignment.status === 'partial' ? 'parcial — conferir' : q.planningAlignment.status === 'misaligned' ? 'divergente — conferir' : 'pendente'}</strong>. {q.planningAlignment.evidence}
            </p>}

            {(diagnosticsByQuestion.get(q.number) ?? []).filter((item) => item.severity !== 'alerta').map((item) => {
              const acknowledged = item.severity === 'revisao_humana' && q.review?.adequacy === 'adequada'
              return (
                <div key={`${item.code}-${item.message}`} className={`mt-3 rounded border p-3 text-xs ${item.severity === 'revisao_humana' ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-red-300 bg-red-50 text-red-800'}`}>
                  <p className="font-semibold">{q.source === 'enem_bank' ? 'Conferência do original' : item.severity === 'revisao_humana' ? 'Confira esta questão' : item.repairAction === 'reparo_local' ? 'Ajuste automático pendente' : 'Confira o conteúdo'}</p>
                  <p className="mt-1">{item.message}</p>
                  {item.evidence && <p className="mt-1 text-[11px] opacity-80">Evidência: {item.evidence}</p>}
                  {acknowledged && <p className="mt-2 font-medium text-harmonia-green">Revisão confirmada pelo professor.</p>}
                  {item.repairAction === 'reparo_local' && reviewEditable && (
                    <button type="button" onClick={() => handleRepairQuestion(q.number)} disabled={regeneratingQuestion === q.number} className="mt-2 rounded border border-current px-2 py-1 font-medium disabled:opacity-60">
                      {regeneratingQuestion === q.number ? 'Corrigindo…' : 'Corrigir automaticamente'}
                    </button>
                  )}
                </div>
              )
            })}

            {q.supportText && <SupportText text={q.supportText} />}
            <p className="mt-2 whitespace-pre-wrap font-medium"><AcervoText text={q.statement} parts={q.acervoInlineContent?.statement} examId={exam.id} /></p>
            {q.whatIfImage && <details className="mt-2 inline-block text-xs text-content-secondary"><summary className="cursor-pointer list-none rounded-full border border-border bg-surface px-2 py-1 hover:bg-surface-subtle">ⓘ Informação de ilustração</summary><p className="mt-1 max-w-2xl rounded border border-border bg-surface-subtle p-2">Briefing interno, sem resposta: {q.whatIfImage}</p></details>}

            {q.image && !(isOriginalBankImage(q) && hasOnlyInlineAcervoMedia(q)) && (
              <div className="mt-3 rounded border border-border bg-surface-subtle p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <button type="button" onClick={() => setExpandedImageQuestion(q.number)} aria-haspopup="dialog" className="group shrink-0 self-start rounded border border-border bg-surface p-1 text-left">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={questionImageUrl(exam.id, q.image.driveFileId)} alt={`Imagem de apoio da questão ${q.number}`} className="max-h-48 w-auto max-w-full rounded object-contain sm:max-h-56" />
                    <span className="mt-1 block text-center text-xs font-medium text-content-secondary group-hover:text-harmonia-green">Ampliar imagem</span>
                  </button>
                  <div className="flex flex-col gap-1 text-xs">
                  <span className="text-neutral-500">
                    {isOriginalBankImage(q) ? 'Imagem original do banco — aceita automaticamente.' : `${IMAGE_SOURCE_LABELS[q.image.source] ?? 'Gerada por IA'} — confirme se é aplicável antes de aprovar.`}
                  </span>
                  {q.image.sourceUrl && !isOriginalBankImage(q) && (
                    <a href={q.image.sourceUrl} target="_blank" rel="noreferrer" className="truncate text-harmonia-green underline">
                      {q.image.sourceUrl}
                    </a>
                  )}
                  <div className="flex gap-2">
                    {isOriginalBankImage(q) ? null : q.image.approved ? (
                      <>
                        <button onClick={() => handleToggleImage(q.number, false)} disabled={!reviewEditable} className="rounded border border-border bg-surface px-2 py-1 font-medium disabled:opacity-60">Cancelar aceitação da imagem</button>
                        <button onClick={() => handleRequestImage(q.number, true)} disabled={!reviewEditable || requestingImage === q.number} className="rounded border border-border bg-surface px-2 py-1 font-medium disabled:opacity-60">{requestingImage === q.number ? 'Gerando nova imagem…' : 'Recusar e gerar nova'}</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => handleToggleImage(q.number, true)} disabled={!reviewEditable} className="rounded bg-harmonia-green px-2 py-1 font-medium text-white disabled:opacity-60">Aceitar imagem</button>
                        <button onClick={() => handleRequestImage(q.number, true)} disabled={!reviewEditable || requestingImage === q.number} className="rounded border border-border bg-surface px-2 py-1 font-medium disabled:opacity-60">{requestingImage === q.number ? 'Gerando nova imagem…' : 'Recusar e gerar nova'}</button>
                      </>
                    )}
                    <button onClick={() => handleRemoveImage(q.number)} disabled={!reviewEditable} className="rounded border border-red-300 bg-surface px-2 py-1 font-medium text-red-700 disabled:opacity-60">Remover imagem</button>
                  </div>
                  <details className="mt-2 rounded border border-border bg-surface p-2">
                    <summary className="cursor-pointer font-medium">Histórico e auditoria ({q.imageHistory?.length ?? 0} versões anteriores)</summary>
                    <div className="mt-2 space-y-2 text-xs text-neutral-600">
                      <p>Versão atual: {q.image.provenance ? `${q.image.provenance.generator} · v${q.image.provenance.generatorVersion}` : IMAGE_SOURCE_LABELS[q.image.source] ?? q.image.source}.</p>
                      {(q.imageHistory ?? []).length === 0 && <p>Nenhuma versão anterior registrada.</p>}
                      {[...(q.imageHistory ?? [])].reverse().map((version, index) => <div key={`${version.driveFileId}-${version.replacedAt}-${index}`} className="flex flex-wrap items-center gap-2 border-t border-border pt-2"><span>Versão anterior · {IMAGE_SOURCE_LABELS[version.source] ?? version.source} · {new Date(version.replacedAt).toLocaleString('pt-BR')}</span>{version.changedBy && <span>por {version.changedBy}</span>}<button onClick={() => handleRestoreImage(q.number, version.driveFileId)} disabled={!reviewEditable || restoringImage === version.driveFileId} className="rounded border border-border px-2 py-1 font-medium disabled:opacity-60">{restoringImage === version.driveFileId ? 'Restaurando…' : 'Restaurar esta versão'}</button></div>)}
                      {(q.imageAuditLog ?? []).length > 0 && <div className="border-t border-border pt-2"><p className="font-medium">Ações</p>{[...(q.imageAuditLog ?? [])].reverse().slice(0, 8).map((entry, index) => <p key={`${entry.at}-${index}`}>{entry.action} · {new Date(entry.at).toLocaleString('pt-BR')} · {entry.actor}</p>)}</div>}
                    </div>
                  </details>
                </div>
                </div>
                {expandedImageQuestion === q.number && (
                  <div role="dialog" aria-modal="true" aria-label={`Imagem ampliada da questão ${q.number}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setExpandedImageQuestion(null)}>
                    <figure className="max-h-full max-w-5xl rounded-lg bg-surface p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                      <div className="mb-3 flex items-center justify-between gap-4"><figcaption className="text-sm font-medium text-content-primary">Imagem de apoio — questão {q.number}</figcaption><button onClick={() => setExpandedImageQuestion(null)} className="rounded border border-border px-2 py-1 text-xs">Fechar</button></div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={questionImageUrl(exam.id, q.image.driveFileId)} alt={`Imagem de apoio ampliada da questão ${q.number}`} className="max-h-[80vh] max-w-full rounded object-contain" />
                    </figure>
                  </div>
                )}
              </div>
            )}

            {q.type === 'objetiva' && q.alternatives && (
              <ul className="mt-2 space-y-1">
                {q.alternatives.map((a) => (
                  <li key={a.letter} className={a.letter === q.correctLetter ? 'font-medium text-harmonia-green' : ''}>
                    {a.letter}){' '}
                    {a.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={questionImageUrl(exam.id, a.image.driveFileId)} alt={`Alternativa ${a.letter} da questão ${q.number}`} className="inline-block max-h-40 w-auto max-w-full rounded border border-border align-top" />
                    ) : (
                      <AcervoText text={a.text || IMAGE_ALTERNATIVE_PLACEHOLDER} parts={q.acervoInlineContent?.alternatives?.[a.letter]} examId={exam.id} />
                    )}
                  </li>
                ))}
              </ul>
            )}

            {q.type === 'descritiva' && (
              <div className="mt-2 space-y-1 text-neutral-600">
                {q.expectedAnswer ? (
                  <p className="whitespace-pre-wrap"><span className="font-medium">Resposta esperada:</span> <MathText text={q.expectedAnswer} /></p>
                ) : (
                  <p role="alert" className="font-medium text-red-700">
                    Sem resposta esperada cadastrada — a correção fica sem base. Use &quot;Trocar só essa questão&quot; para regenerar antes de concluir a revisão.
                  </p>
                )}
                {originalAcervoMedia(q, 'resolucao').map((media) => <figure key={media.id} className="my-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={originalAcervoMediaUrl(exam.id, media.id)} alt={media.texto_alternativo || `Resolução original da questão ${q.number}`} className="max-h-80 max-w-full object-contain" loading="lazy" />
                  <figcaption className="mt-1 text-xs">Fórmula ou imagem da resolução original.</figcaption>
                </figure>)}
                {q.gradingCriteria && <p className="whitespace-pre-wrap"><span className="font-medium">Critérios:</span> <MathText text={q.gradingCriteria} /></p>}
              </div>
            )}

            {reviewEditable && (
              <div className="mt-4 space-y-3 rounded border border-border bg-surface-subtle p-3">
                <p className="text-xs text-neutral-600">Decida esta questão para liberar a aprovação definitiva.</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => handleRegenerateQuestion(q.number, 'acervo')} disabled={regeneratingQuestion !== null} className="min-h-10 rounded border border-border bg-surface px-3 py-2 text-left text-xs font-medium text-content-primary transition-colors hover:bg-surface-subtle disabled:opacity-60">
                    {regeneratingQuestion === q.number ? 'Buscando no banco…' : 'Buscar no Banco'}
                  </button>
                  <button type="button" onClick={() => handleRegenerateQuestion(q.number, 'ia')} disabled={regeneratingQuestion !== null} className="min-h-10 rounded bg-harmonia-green px-3 py-2 text-left text-xs font-semibold text-white transition-colors hover:bg-harmonia-green/90 disabled:opacity-60">
                    {regeneratingQuestion === q.number ? 'Gerando…' : 'Gerar nova com IA ✨'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {q.review?.adequacy === 'adequada' ? (
                    <button onClick={() => handleReviewNote(q.number, { adequacy: null })} disabled={savingReview === q.number} className="rounded border border-border bg-surface px-3 py-1.5 text-xs font-medium text-content-primary disabled:opacity-60">Cancelar aceitação da questão</button>
                  ) : (
                    <>
                      <button onClick={() => handleAcceptQuestion(q.number)} disabled={savingReview === q.number} className="rounded bg-harmonia-green px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">{savingReview === q.number ? 'Salvando…' : (diagnosticsByQuestion.get(q.number) ?? []).some((item) => item.severity === 'revisao_humana' && item.blocksApproval) ? 'Confirmar revisão e aceitar questão' : 'Aceitar questão'}</button>
                      {!q.image && <button onClick={() => handleRequestImage(q.number)} disabled={requestingImage === q.number} className="rounded border border-border bg-surface px-3 py-1.5 text-xs font-medium text-content-primary disabled:opacity-60">{requestingImage === q.number ? 'Gerando imagem…' : 'Gerar imagem'}</button>}
                      <button onClick={() => handleAnalyzeIllustrations(q.number)} disabled={analyzingIllustrations === q.number} className="rounded border border-border bg-surface px-3 py-1.5 text-xs font-medium text-content-primary disabled:opacity-60">{analyzingIllustrations === q.number ? 'Analisando recursos visuais…' : 'Ver ilustrações recomendadas'}</button>
                    </>
                  )}
                </div>
                {imageConfirmation === q.number && <div className="flex flex-wrap items-center gap-2 rounded bg-amber-50 p-2 text-xs text-amber-900"><span>Esta questão não precisa de imagem. Gerar mesmo assim?</span><button onClick={() => handleRequestImage(q.number, true)} className="rounded bg-amber-700 px-2 py-1 font-medium text-white">Gerar mesmo assim</button><button onClick={() => setImageConfirmation(null)} className="underline">Cancelar</button></div>}
                {illustrationAnalyses[q.number] && <div className={`space-y-2 rounded border p-3 text-xs ${illustrationAnalyses[q.number].decision === 'missing_required_visual' ? 'border-red-500/40 bg-red-500/5' : 'border-harmonia-green/30 bg-surface'}`}><p className="font-medium">Análise visual da questão</p><p className="text-neutral-600">{illustrationAnalyses[q.number].reason}</p>{illustrationAnalyses[q.number].recommendations.map((recommendation) => <div key={recommendation.generator} className="flex flex-wrap items-center gap-2"><span><strong>{recommendation.title}</strong> — {recommendation.rationale}</span><button onClick={() => handleGenerateRecommendedIllustration(q.number, recommendation)} disabled={renderingIllustration === q.number} className="rounded bg-harmonia-green px-2 py-1 font-medium text-white disabled:opacity-60">{renderingIllustration === q.number ? 'Gerando…' : 'Usar esta ilustração'}</button></div>)}</div>}

                {actionError[q.number] && <p className="text-xs text-red-600">{actionError[q.number]}</p>}
              </div>
            )}
          </article>
        ))}
      </div>

      {hasFixedApprovalAction && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className={`text-sm ${jevPendingCount || pendingReviewItems.length ? 'text-amber-800' : 'text-harmonia-green'}`}>
              {usesWholeExamEngine
                ? pendingReviewItems.length
                  ? `${pendingReviewItems.length} pendência(s) de revisão humana.`
                  : 'Confira o conteúdo e as imagens; as conferências determinísticas estão concluídas.'
                : jevPendingCount
                ? 'A conferência automática será retomada ao finalizar.'
                : pendingReviewItems.length
                  ? `${pendingReviewItems.length} pendência(s) de aprovação humana.`
                  : 'Todas as questões e imagens foram revisadas.'}
            </p>
            <button
              onClick={() => handleTransition(exam.status === 'em_revisao' ? 'aprovar_prova' : 'aprovar')}
              disabled={transitioning}
              className="min-h-10 rounded bg-harmonia-green px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {transitioning ? 'Aprovando e gerando documentos…' : exam.status === 'em_revisao' ? 'Aprovar prova e gerar documentos' : 'Aprovar e gerar documentos'}
            </button>
          </div>
        </div>
      )}
      {addingQuestion && (
        <AddQuestionModal
          examId={examId}
          onClose={() => setAddingQuestion(false)}
          onAdded={handleQuestionAdded}
        />
      )}
    </div>
  )
}
