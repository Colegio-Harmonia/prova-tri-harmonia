'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { hasLatexSegments, splitLatexSegments, buildLatexImageUrl, IMAGE_ALTERNATIVE_PLACEHOLDER } from '@/lib/math/latexRender'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { ReviewProgress } from '@/features/assessments/components/ReviewProgress'
import PublishToClassroom from './PublishToClassroom'
import ActivityClassroomResults from './ActivityClassroomResults'
import SheetAssignmentsPanel from './SheetAssignmentsPanel'
import { downloadSheetAssignments } from './downloadSheetAssignments'
import { canFinalizeOwnActivity, canMarkOwnActivityApplied } from '@/lib/exams/activityWorkflow'
import { questionImageUrl } from '@/lib/images/questionImageUrl'

// Fórmula em $...$ vira imagem tipografada de verdade (renderização
// externa, mesmo padrão já usado pros gráficos de questão) — pedido
// direto: "2^(n-1)" em ASCII solto é difícil de ler, longe de livro
// impresso.
function MathText({ text }: { text: string | null | undefined }) {
  if (!hasLatexSegments(text)) return <>{text ?? ''}</>
  return (
    <>
      {splitLatexSegments(text).map((seg, i) =>
        seg.type === 'text' ? (
          <span key={i}>{seg.content}</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={buildLatexImageUrl(seg.latex)} alt={seg.latex} className={seg.display ? 'my-2 block h-auto max-h-40 w-auto' : 'mx-0.5 inline-block h-[1.1em] w-auto align-middle'} />
        ),
      )}
    </>
  )
}

// A geração pode usar Markdown para dados de apoio. O documento final já
// transforma tabelas em imagem; aqui renderizamos uma tabela HTML para que
// a aprovação humana nunca precise interpretar caracteres "|" crus.
function SupportText({ text }: { text: string }) {
  const lines = text.split('\n')
  const dividerIndex = lines.findIndex((line, index) => index > 0 && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
  if (dividerIndex <= 0) return <p className="mt-2 text-content-secondary"><MathText text={text} /></p>
  const header = lines[dividerIndex - 1].split('|').map((cell) => cell.trim()).filter(Boolean)
  const rows = lines.slice(dividerIndex + 1).filter((line) => line.includes('|')).map((line) => line.split('|').map((cell) => cell.trim()).filter(Boolean))
  if (header.length < 2 || !rows.length || rows.some((row) => row.length !== header.length)) return <p className="mt-2 text-content-secondary"><MathText text={text} /></p>
  const before = lines.slice(0, dividerIndex - 1).join('\n').trim()
  const after = lines.slice(dividerIndex + 1 + rows.length).join('\n').trim()
  return <div className="mt-2 space-y-2 text-content-secondary">
    {before && <p><MathText text={before} /></p>}
    <div className="overflow-x-auto rounded border border-border"><table className="min-w-full text-left text-sm"><thead className="bg-surface-subtle"> <tr>{header.map((cell, index) => <th key={index} className="border-b border-border px-3 py-2 font-medium"><MathText text={cell} /></th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-border/70 last:border-0">{row.map((cell, index) => <td key={index} className="px-3 py-2"><MathText text={cell} /></td>)}</tr>)}</tbody></table></div>
    {after && <p><MathText text={after} /></p>}
  </div>
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
type Action = 'atribuir' | 'iniciar_revisao' | 'aprovar_prova' | 'concluir_revisao' | 'aprovar' | 'marcar_impresso' | 'marcar_aplicado' | 'marcar_corrigido' | 'finalizar_atividade' | 'marcar_atividade_aplicada'

const IMAGE_SOURCE_LABELS: Record<string, string> = {
  busca: 'Encontrada (Wikimedia Commons)',
  grafico: 'Gráfico renderizado a partir dos dados da questão',
  diagrama: 'Diagrama matemático renderizado a partir dos dados da questão',
  quimica: 'Estrutura química renderizada a partir da fórmula da questão',
  gerada: 'Gerada por IA',
  importado: 'Importada de link colado pelo professor',
  enem: 'Original da prova do ENEM (mesma imagem aplicada na época)',
}
const ILLUSTRATION_OPTIONS: Record<string, Array<{ id: string; label: string; example: string }>> = {
  matematica: [{ id: 'math.function.graph', label: 'Gráfico de função', example: '{"expression":"x^2 - 4*x + 3","domain":[-5,5]}' }, { id: 'math.data.chart', label: 'Gráfico estatístico', example: '{"title":"Pesquisa","type":"bar","labels":["A","B"],"values":[12,18]}' }],
  geografia: [{ id: 'geography.choropleth', label: 'Mapa temático', example: '{"title":"Mapa","geoJson":{"type":"FeatureCollection","features":[]},"highlightNames":[]}' }],
  historia: [{ id: 'history.historical-map', label: 'Mapa histórico (GeoJSON autorizado)', example: '{"title":"Mapa histórico","geoJson":{"type":"FeatureCollection","features":[]},"highlightNames":[]}' }],
  biologia: [{ id: 'biology.phylogeny', label: 'Cladograma', example: '{"title":"Cladograma","newick":"((Humano,Chimpanzé),Gorila);"}' }],
  quimica: [{ id: 'chemistry.structure', label: 'Estrutura química', example: '{"smiles":"CCO"}' }],
  fisica: [{ id: 'physics.circuit', label: 'Circuito elétrico', example: '{"components":[{"kind":"source","label":"9 V"},{"kind":"resistor","label":"100 Ω"},{"kind":"ground"}]}' }],
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
    if (question.image && !question.image.approved) pending.push(`Imagem da questão ${question.number} não aprovada`)
    return pending
  })
}

function firstPendingQuestion(payload: ExamGenerationResult): number | null {
  const question = payload.questions.find((item) => item.review?.adequacy !== 'adequada' || Boolean(item.image && !item.image.approved))
  return question?.number ?? null
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
  const [graphEditorQuestion, setGraphEditorQuestion] = useState<number | null>(null)
  const [graphExpression, setGraphExpression] = useState('x^2')
  const [graphDomain, setGraphDomain] = useState('-5, 5')
  const [technicalEditorQuestion, setTechnicalEditorQuestion] = useState<number | null>(null)
  const [technicalGenerator, setTechnicalGenerator] = useState('')
  const [technicalParameters, setTechnicalParameters] = useState('')
  const [imageConfirmation, setImageConfirmation] = useState<number | null>(null)
  const [actionError, setActionError] = useState<Record<number, string>>({})
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [expandedImageQuestion, setExpandedImageQuestion] = useState<number | null>(null)
  const [reviewBlocker, setReviewBlocker] = useState<{ items: string[]; firstQuestion: number | null } | null>(null)
  const [qualityReportOpen, setQualityReportOpen] = useState(false)

  const isCoordenacao = isStaffSuperuser(currentUserRole)
  const canAssignFormalExam = Boolean(
    exam?.examKind === 'prova' &&
    exam.status === 'rascunho' &&
    (isCoordenacao || exam.createdBy === currentUserId),
  )

  useEffect(() => {
    if (!reviewBlocker?.firstQuestion) return
    const timer = window.setTimeout(() => {
      document.getElementById(`question-${reviewBlocker.firstQuestion}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
    return () => window.clearTimeout(timer)
  }, [reviewBlocker])

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

  async function load() {
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
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId])

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

  async function handleRegenerateQuestion(questionNumber: number) {
    setRegeneratingQuestion(questionNumber)
    setActionError((prev) => ({ ...prev, [questionNumber]: '' }))
    try {
      const res = await fetch(`/api/exams/${examId}/regenerate-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionNumber }),
      })
      const data = await res.json()
      if (!res.ok) {
        setActionError((prev) => ({ ...prev, [questionNumber]: data.error ?? 'Erro ao trocar questão.' }))
        return
      }
      patchQuestion(questionNumber, data.question)
    } catch {
      setActionError((prev) => ({ ...prev, [questionNumber]: 'Falha de rede ao trocar questão.' }))
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

  async function handleRenderFunctionGraph(questionNumber: number) {
    const domain = graphDomain.split(',').map((value) => Number(value.trim()))
    if (domain.length !== 2 || domain.some((value) => !Number.isFinite(value)) || domain[0] >= domain[1]) {
      setActionError((previous) => ({ ...previous, [questionNumber]: 'Informe o domínio como dois números, por exemplo: -5, 5.' }))
      return
    }
    setRenderingIllustration(questionNumber)
    setActionError((previous) => ({ ...previous, [questionNumber]: '' }))
    try {
      const res = await fetch(`/api/exams/${examId}/render-illustration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionNumber,
          generator: 'math.function.graph',
          parameters: { expression: graphExpression, domain },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setActionError((previous) => ({ ...previous, [questionNumber]: data.error ?? 'Não foi possível gerar o gráfico.' }))
        return
      }
      patchQuestion(questionNumber, { needsImage: true, image: data.image })
      setGraphEditorQuestion(null)
    } catch {
      setActionError((previous) => ({ ...previous, [questionNumber]: 'Falha de rede ao gerar o gráfico.' }))
    } finally {
      setRenderingIllustration(null)
    }
  }

  async function handleRenderTechnicalIllustration(questionNumber: number) {
    let parameters: unknown
    try { parameters = JSON.parse(technicalParameters) } catch { setActionError((previous) => ({ ...previous, [questionNumber]: 'Os parâmetros precisam estar em JSON válido.' })); return }
    setRenderingIllustration(questionNumber)
    try {
      const res = await fetch(`/api/exams/${examId}/render-illustration`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionNumber, generator: technicalGenerator, parameters }) })
      const data = await res.json()
      if (!res.ok) { setActionError((previous) => ({ ...previous, [questionNumber]: data.error ?? 'Não foi possível gerar a ilustração.' })); return }
      patchQuestion(questionNumber, { needsImage: true, image: data.image }); setTechnicalEditorQuestion(null)
    } catch { setActionError((previous) => ({ ...previous, [questionNumber]: 'Falha de rede ao gerar a ilustração.' })) } finally { setRenderingIllustration(null) }
  }


  async function handleTransition(action: Action, assignedTo?: number, printWindow?: Window | null) {
    if ((action === 'concluir_revisao' || action === 'aprovar_prova') && exam) {
      const pending = reviewPendingItems(exam.generationPayload)
      if (pending.length) {
        setReviewBlocker({ items: pending, firstQuestion: firstPendingQuestion(exam.generationPayload) })
        return
      }
    }
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
  const subjectKey = exam.subject.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const isMathExam = subjectKey === 'matematica'
  const illustrationOptions = ILLUSTRATION_OPTIONS[subjectKey] ?? []
  const reviewEditable =
    exam.status === 'rascunho' || exam.status === 'atribuido' || exam.status === 'em_andamento' || exam.status === 'revisao_concluida' || exam.status === 'em_revisao'
  const isAssignee = exam.assignedTo != null && exam.assignedTo === currentUserId
  const isOwnActivity = exam.examKind !== 'prova' && exam.createdBy === currentUserId
  const canActOnOwnStep = isCoordenacao || isAssignee || isOwnActivity
  const canFinalizeActivity = canFinalizeOwnActivity(exam, currentUserId, isCoordenacao)
  const canMarkActivityApplied = canMarkOwnActivityApplied(exam, currentUserId, isCoordenacao)
  const pendingReviewItems = reviewPendingItems(payload)
  const hasFixedApprovalAction =
    (canActOnOwnStep && exam.status === 'em_revisao') ||
    (isCoordenacao && exam.status === 'revisao_concluida')

  return (
    <div className={`space-y-6 ${hasFixedApprovalAction ? 'pb-28' : ''}`}>
      <div aria-live="polite" className="sr-only">{actionMessage}</div>
      {reviewBlocker && (
        <div role="dialog" aria-modal="true" aria-labelledby="review-blocker-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setReviewBlocker(null)}>
          <div className="w-full max-w-md rounded-xl bg-surface p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h2 id="review-blocker-title" className="text-base font-semibold">Ainda não é possível aprovar a prova</h2>
            <p className="mt-1 text-sm text-neutral-600">Faltam decisões humanas nos itens abaixo:</p>
            <ul className="mt-3 space-y-1 text-sm">{reviewBlocker.items.map((item) => <li key={item}>• {item}</li>)}</ul>
            <button onClick={() => setReviewBlocker(null)} className="mt-4 rounded bg-harmonia-green px-3 py-2 text-sm font-medium text-white">Ir para a primeira pendência</button>
          </div>
        </div>
      )}
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
          {exam.status === 'rascunho' && (
            <button onClick={handleRegenerate} disabled={regenerating} className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-60">
              {regenerating ? 'Regenerando…' : 'Regenerar'}
            </button>
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
                onClick={() => selectedAssignee && handleTransition('atribuir', selectedAssignee)}
                disabled={transitioning || !selectedAssignee}
                className="rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                Atribuir
              </button>
            </div>
          )}

          {canFinalizeActivity && (
            <button
              onClick={() => handleTransition('finalizar_atividade')}
              disabled={transitioning}
              className="min-h-10 whitespace-nowrap rounded bg-harmonia-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {transitioning ? 'Finalizando e gerando documentos…' : 'Finalizar atividade e gerar documentos'}
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
              disabled={transitioning || !isCoordenacao || !['aprovado', 'impresso', 'aplicado', 'parcialmente_corrigida', 'corrigido'].includes(exam.status)}
              title={exam.status === 'aprovado' ? undefined : 'A impressão é liberada após a aprovação da prova.'}
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

      <section className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" aria-labelledby="ai-review-notice">
        <h2 id="ai-review-notice" className="font-semibold">Revisão obrigatória do conteúdo assistido por IA</h2>
        <p className="mt-1">A IA fornece um rascunho. Antes de {exam.examKind === 'prova' ? 'aprovar' : 'finalizar a atividade'}, confira enunciados, alternativas, gabarito, nível de dificuldade, habilidades e imagens.</p>
        {payload.metadata.qualityTest && <div className="mt-2 text-xs"><p>Teste de qualidade {payload.metadata.qualityTest.repairedQuestionNumbers.length ? `reparou automaticamente as questões ${payload.metadata.qualityTest.repairedQuestionNumbers.join(', ')}.` : 'aprovado antes da prova ser salva.'}</p>{payload.metadata.qualityTest.reports?.length ? <button type="button" onClick={() => setQualityReportOpen(true)} className="mt-2 font-medium text-harmonia-green underline">Abrir relatório detalhado do teste de qualidade</button> : null}</div>}
      </section>

      {qualityReportOpen && payload.metadata.qualityTest?.reports && <div role="dialog" aria-modal="true" aria-labelledby="quality-report-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setQualityReportOpen(false)}><section className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-surface p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><h2 id="quality-report-title" className="text-lg font-semibold">Relatório detalhado do teste de qualidade</h2><p className="mt-1 text-sm text-content-secondary">Critérios verificáveis usados antes de salvar a prova.</p></div><button type="button" onClick={() => setQualityReportOpen(false)} className="rounded border border-border px-3 py-1.5 text-sm">Fechar</button></div><div className="mt-5 space-y-6">{payload.metadata.qualityTest.reports.map((report, index) => <section key={`${report.phase}-${index}`}><h3 className="font-semibold text-content-primary">{report.phase}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2">{report.results.map((result) => <article key={result.questionNumber} className={`rounded-lg border p-3 ${result.approved ? 'border-harmonia-green/30 bg-harmonia-green/5' : 'border-red-200 bg-red-50'}`}><div className="flex items-center justify-between gap-2"><p className="font-medium">Questão {result.questionNumber}</p><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${result.approved ? 'bg-harmonia-green/10 text-harmonia-green' : 'bg-red-100 text-red-700'}`}>{result.approved ? 'Aprovada' : 'Reprovada'}</span></div>{result.verdictReason && <p className="mt-2 text-sm text-content-secondary">{result.verdictReason}</p>}{result.checks?.length ? <ul className="mt-3 space-y-2 text-xs">{result.checks.map((check, checkIndex) => <li key={checkIndex} className="rounded bg-surface p-2"><p className="font-medium">{check.criterion.replace(/_/g, ' ')} · {check.status}</p><p className="mt-0.5 text-content-secondary">{check.evidence}</p></li>)}</ul> : null}{result.issues.length ? <ul className="mt-3 list-disc pl-4 text-xs text-red-800">{result.issues.map((issue, issueIndex) => <li key={issueIndex}>{issue.severity}: {issue.reason}</li>)}</ul> : null}</article>)}</div></section>)}</div></section></div>}

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

      {exam.unmappedWarnings && exam.unmappedWarnings.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-medium">Avisos</p>
          <ul className="mt-1 list-disc pl-5">
            {exam.unmappedWarnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <div className="space-y-6">
        {payload.questions.map((q) => (
          <article id={`question-${q.number}`} key={q.number} className="relative scroll-mt-6 overflow-hidden rounded-xl border border-border bg-surface p-5 text-sm text-content-primary shadow-sm">
            <div className="absolute inset-y-0 left-0 w-1 bg-harmonia-green/70" />
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-harmonia-green px-2.5 py-1 font-semibold text-white">Questão {q.number}</span>
              {q.source === 'enem_bank' ? (
                <span className="rounded bg-violet-50 px-2 py-0.5 font-medium text-violet-700">
                  Questão real — ENEM {q.enemBankRef?.year}
                </span>
              ) : (
                <>
                  <span className="rounded bg-surface-subtle px-2 py-0.5 text-content-secondary">{q.type}</span>
                  <span className="rounded bg-surface-subtle px-2 py-0.5 text-content-secondary">Bloom: {q.bloomLevel}</span>
                  <span className={`rounded px-2 py-0.5 ${q.bnccStatus === 'mapeado' ? 'bg-harmonia-green/10 text-harmonia-green' : 'bg-neutral-100 text-neutral-500'}`}>
                    {q.bnccStatus === 'mapeado' ? q.bnccCodes.join(', ') : 'BNCC não mapeada'}
                  </span>
                </>
              )}
              <span className="rounded bg-surface-subtle px-2 py-0.5 text-content-secondary">
                SAEB/ENEM: {q.saeb.applicable ? `${q.saeb.value ?? '—'}${q.saeb.approximate ? ' (aproximado)' : ''}` : 'N/A'}
              </span>
            </div>

            {q.supportText && <SupportText text={q.supportText} />}
            <p className="mt-2 font-medium"><MathText text={q.statement} /></p>

            {q.image && (
              <div className="mt-3 rounded border border-border bg-surface-subtle p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <button type="button" onClick={() => setExpandedImageQuestion(q.number)} aria-haspopup="dialog" className="group shrink-0 self-start rounded border border-border bg-surface p-1 text-left">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={questionImageUrl(exam.id, q.image.driveFileId)} alt={`Imagem de apoio da questão ${q.number}`} className="max-h-48 w-auto max-w-full rounded object-contain sm:max-h-56" />
                    <span className="mt-1 block text-center text-xs font-medium text-content-secondary group-hover:text-harmonia-green">Ampliar imagem</span>
                  </button>
                  <div className="flex flex-col gap-1 text-xs">
                  <span className="text-neutral-500">
                    {IMAGE_SOURCE_LABELS[q.image.source] ?? 'Gerada por IA'} — confirme se é aplicável antes de aprovar.
                  </span>
                  {q.image.sourceUrl && (
                    <a href={q.image.sourceUrl} target="_blank" rel="noreferrer" className="truncate text-harmonia-green underline">
                      {q.image.sourceUrl}
                    </a>
                  )}
                  <div className="flex gap-2">
                    {q.image.approved ? (
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
                    {isMathExam && <button onClick={() => { setGraphEditorQuestion(q.number); setGraphExpression('x^2'); setGraphDomain('-5, 5') }} disabled={!reviewEditable} className="rounded border border-border bg-surface px-2 py-1 font-medium disabled:opacity-60">Substituir por gráfico de função</button>}
                  </div>
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
                    {a.letter}) <MathText text={a.text || IMAGE_ALTERNATIVE_PLACEHOLDER} />
                  </li>
                ))}
              </ul>
            )}

            {q.type === 'descritiva' && (
              <div className="mt-2 space-y-1 text-neutral-600">
                {q.expectedAnswer && <p><span className="font-medium">Resposta esperada:</span> <MathText text={q.expectedAnswer} /></p>}
                {q.gradingCriteria && <p><span className="font-medium">Critérios:</span> <MathText text={q.gradingCriteria} /></p>}
              </div>
            )}

            {reviewEditable && (
              <div className="mt-4 space-y-3 rounded border border-border bg-surface-subtle p-3">
                <p className="text-xs text-neutral-600">Decida esta questão para liberar a aprovação definitiva.</p>
                <div className="flex flex-wrap gap-2">
                  {q.review?.adequacy === 'adequada' ? (
                    <button onClick={() => handleReviewNote(q.number, { adequacy: null })} disabled={savingReview === q.number} className="rounded border border-border bg-surface px-3 py-1.5 text-xs font-medium text-content-primary disabled:opacity-60">Cancelar aceitação da questão</button>
                  ) : (
                    <>
                      <button onClick={() => handleAcceptQuestion(q.number)} disabled={savingReview === q.number} className="rounded bg-harmonia-green px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">{savingReview === q.number ? 'Salvando…' : 'Aceitar questão'}</button>
                      {q.source !== 'enem_bank' && <button onClick={() => handleRegenerateQuestion(q.number)} disabled={regeneratingQuestion === q.number} className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">{regeneratingQuestion === q.number ? 'Gerando…' : 'Recusar e gerar nova'}</button>}
                      {!q.image && <button onClick={() => handleRequestImage(q.number)} disabled={requestingImage === q.number} className="rounded border border-border bg-surface px-3 py-1.5 text-xs font-medium text-content-primary disabled:opacity-60">{requestingImage === q.number ? 'Gerando imagem…' : 'Gerar imagem'}</button>}
                      {illustrationOptions.length > 0 && <button onClick={() => { const option = illustrationOptions[0]; setTechnicalEditorQuestion(q.number); setTechnicalGenerator(option.id); setTechnicalParameters(option.example) }} className="rounded border border-border bg-surface px-3 py-1.5 text-xs font-medium text-content-primary">Gerar ilustração técnica</button>}
                      {isMathExam && <button onClick={() => { setGraphEditorQuestion(q.number); setGraphExpression('x^2'); setGraphDomain('-5, 5') }} className="rounded border border-border bg-surface px-3 py-1.5 text-xs font-medium text-content-primary">Gerar gráfico de função</button>}
                    </>
                  )}
                </div>
                {imageConfirmation === q.number && <div className="flex flex-wrap items-center gap-2 rounded bg-amber-50 p-2 text-xs text-amber-900"><span>Esta questão não precisa de imagem. Gerar mesmo assim?</span><button onClick={() => handleRequestImage(q.number, true)} className="rounded bg-amber-700 px-2 py-1 font-medium text-white">Gerar mesmo assim</button><button onClick={() => setImageConfirmation(null)} className="underline">Cancelar</button></div>}
                {graphEditorQuestion === q.number && <div className="space-y-2 rounded border border-harmonia-green/30 bg-surface p-3 text-xs"><p className="font-medium">Gráfico determinístico (sem IA)</p><label className="block">Função, usando apenas x e operações básicas (ex.: <code>x^2 - 4*x + 3</code>)<input value={graphExpression} onChange={(event) => setGraphExpression(event.target.value)} className="mt-1 block w-full rounded border border-border px-2 py-1.5 text-sm" /></label><label className="block">Domínio, mínimo e máximo (ex.: <code>-5, 5</code>)<input value={graphDomain} onChange={(event) => setGraphDomain(event.target.value)} className="mt-1 block w-full rounded border border-border px-2 py-1.5 text-sm" /></label><div className="flex gap-2"><button onClick={() => handleRenderFunctionGraph(q.number)} disabled={renderingIllustration === q.number} className="rounded bg-harmonia-green px-2 py-1.5 font-medium text-white disabled:opacity-60">{renderingIllustration === q.number ? 'Renderizando…' : 'Gerar gráfico'}</button><button onClick={() => setGraphEditorQuestion(null)} className="rounded border border-border px-2 py-1.5">Cancelar</button></div></div>}
                {technicalEditorQuestion === q.number && <div className="space-y-2 rounded border border-harmonia-green/30 bg-surface p-3 text-xs"><p className="font-medium">Ilustração técnica determinística</p><select value={technicalGenerator} onChange={(event) => { const option = illustrationOptions.find((item) => item.id === event.target.value); setTechnicalGenerator(event.target.value); if (option) setTechnicalParameters(option.example) }} className="w-full rounded border border-border px-2 py-1.5 text-sm">{illustrationOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><textarea value={technicalParameters} onChange={(event) => setTechnicalParameters(event.target.value)} rows={5} className="w-full rounded border border-border p-2 font-mono text-xs" aria-label="Parâmetros da ilustração" /><div className="flex gap-2"><button onClick={() => handleRenderTechnicalIllustration(q.number)} disabled={renderingIllustration === q.number} className="rounded bg-harmonia-green px-2 py-1.5 font-medium text-white disabled:opacity-60">{renderingIllustration === q.number ? 'Renderizando…' : 'Gerar ilustração'}</button><button onClick={() => setTechnicalEditorQuestion(null)} className="rounded border border-border px-2 py-1.5">Cancelar</button></div></div>}

                {actionError[q.number] && <p className="text-xs text-red-600">{actionError[q.number]}</p>}
              </div>
            )}
          </article>
        ))}
      </div>

      {hasFixedApprovalAction && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.12)] backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className={`text-sm ${pendingReviewItems.length ? 'text-amber-800' : 'text-harmonia-green'}`}>
              {pendingReviewItems.length
                ? `${pendingReviewItems.length} pendência(s) de aprovação humana.`
                : 'Todas as questões e imagens necessárias foram aprovadas.'}
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
    </div>
  )
}
