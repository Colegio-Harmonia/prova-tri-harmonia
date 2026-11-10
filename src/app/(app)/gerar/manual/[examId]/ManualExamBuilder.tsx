'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { manualClassificationComplete } from '@/lib/exams/creationMode'
import { ACERVO_BROWSER_ORIGIN, acervoBrowserPath } from '@/lib/exams/acervoBrowser'
import { AcervoText } from '@/components/ui/AcervoText'
import type { ManualPlanningGuide } from '@/lib/exams/manualPlanningGuide'
import ManualPlanningGuideCard from './ManualPlanningGuideCard'
import { currentBimester } from '@/lib/exams/currentBimester'
import { questionProvenanceTags } from '@/lib/exams/questionOrigin'

type ImportFeedback = { status: 'queued' | 'importing' | 'imported' | 'error' | 'available'; message?: string }

export default function ManualExamBuilder({ examId, initialExam, planningGuide = { plans: [] } }: { examId: number; initialExam: ExamGenerationResult; planningGuide?: ManualPlanningGuide }) {
  const router = useRouter()
  const [exam, setExam] = useState(initialExam)
  const [planningSemester, setPlanningSemester] = useState((initialExam.metadata.bimester ?? currentBimester()) <= 2 ? 1 : 2)
  const [busy, setBusy] = useState(false)
  const mutationChain = useRef<Promise<unknown>>(Promise.resolve())
  const examRef = useRef(initialExam)
  const pendingImports = useRef(new Set<number>())
  const [imports, setImports] = useState<Record<number, ImportFeedback>>({})
  const [error, setError] = useState('')
  const [browserOpen, setBrowserOpen] = useState(false)
  const [browserHtml, setBrowserHtml] = useState('')
  const [browserUrl, setBrowserUrl] = useState('')
  const [browserError, setBrowserError] = useState('')
  const frame = useRef<HTMLIFrameElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const [questionId, setQuestionId] = useState('')
  const [saved, setSaved] = useState('')
  const updateImport = useCallback((questionId: number, status: ImportFeedback['status'], message?: string) => {
    setImports((previous) => ({ ...previous, [questionId]: { status, message } }))
    frame.current?.contentWindow?.postMessage({ type: 'acervo:import-status', questionId, status, message }, browserUrl ? ACERVO_BROWSER_ORIGIN : '*')
  }, [browserUrl])
  const action = useCallback((body: Record<string, unknown>) => {
    const run = async () => {
      setBusy(true); setError(''); setSaved('')
      if (body.action === 'import') updateImport(Number(body.questionId), 'importing')
      try {
        const response = await fetch(`/api/exams/${examId}/manual`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? 'Não foi possível salvar a prova.')
        examRef.current = data.exam
        setExam(data.exam)
        setSaved(body.action === 'import' ? 'Questão importada e salva no rascunho.' : 'Rascunho salvo.')
        setQuestionId('')
        if (body.action === 'finish') router.push(`/gerar/${examId}/revisar`)
        if (body.action === 'remove') updateImport(Number(body.questionId), 'available')
        return { ok: true as const }
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : 'Falha ao salvar. Tente novamente.'
        setError(message)
        return { ok: false as const, message }
      } finally { setBusy(false) }
    }
    // Preserve click order and merge each server response before the next mutation.
    const result = mutationChain.current.then(run, run)
    mutationChain.current = result
    return result
  }, [examId, router, updateImport])

  const enqueueImport = useCallback((id: number) => {
    if (!Number.isSafeInteger(id) || id <= 0) return
    if (pendingImports.current.has(id)) return
    if (examRef.current.questions.some((question) => question.acervoRef?.questionId === id)) { updateImport(id, 'imported'); return }
    if (examRef.current.questions.length + pendingImports.current.size >= 30) { updateImport(id, 'error', 'A prova pode ter até 30 questões, incluindo as que estão na fila.'); return }
    pendingImports.current.add(id)
    updateImport(id, 'queued')
    void action({ action: 'import', questionId: id }).then((result) => {
      pendingImports.current.delete(id)
      updateImport(id, result.ok ? 'imported' : 'error', result.ok ? undefined : result.message)
    })
  }, [action, updateImport])

  function syncImportStatus() {
    for (const question of examRef.current.questions) {
      if (question.acervoRef) frame.current?.contentWindow?.postMessage({ type: 'acervo:import-status', questionId: question.acervoRef.questionId, status: 'imported' }, browserUrl ? ACERVO_BROWSER_ORIGIN : '*')
    }
    for (const [id, feedback] of Object.entries(imports)) {
      frame.current?.contentWindow?.postMessage({ type: 'acervo:import-status', questionId: Number(id), ...feedback }, browserUrl ? ACERVO_BROWSER_ORIGIN : '*')
    }
  }

  useEffect(() => {
    if (!browserOpen) return
    const openedDialog = dialog.current
    openedDialog?.showModal()
    const controller = new AbortController()
    setBrowserError('')
    if (!browserHtml && !browserUrl) fetch(`/api/exams/manual/browser?${new URLSearchParams({ subject: exam.metadata.subject, parentOrigin: window.location.origin })}`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      if (data.url && new URL(data.url).origin === ACERVO_BROWSER_ORIGIN) setBrowserUrl(data.url)
      else setBrowserHtml(data.html)
    }).catch((failure) => { if (!controller.signal.aborted) setBrowserError(failure.message || 'Falha ao abrir o banco.') })
    return () => { controller.abort(); openedDialog?.close() }
  }, [browserOpen, browserHtml, browserUrl, exam.metadata.subject])

  useEffect(() => {
    const receive = async (event: MessageEvent) => {
      if (!browserOpen || event.source !== frame.current?.contentWindow || event.origin !== (browserUrl ? ACERVO_BROWSER_ORIGIN : 'null')) return
      const message = event.data
      if (message?.type === 'acervo:select' && Number.isSafeInteger(message.questionId) && message.questionId > 0) {
        enqueueImport(message.questionId)
      } else if (!browserUrl && message?.type === 'acervo:read' && Number.isSafeInteger(message.id) && typeof message.path === 'string') {
        const path = acervoBrowserPath(message.path)
        if (!path) return
        const target = frame.current?.contentWindow
        try {
          const response = await fetch(`/api/exams/manual/catalog?${new URLSearchParams({ path })}`)
          const body = await response.json()
          target?.postMessage({ type: 'acervo:response', id: message.id, ok: response.ok, body }, '*')
        } catch { target?.postMessage({ type: 'acervo:response', id: message.id, ok: false, body: { error: { mensagem: 'Falha na consulta. Tente novamente.' } } }, '*') }
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [browserOpen, browserUrl, enqueueImport])

  function move(index: number, delta: number) {
    const ids = exam.questions.map((q) => q.acervoRef!.questionId)
    ;[ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]
    void action({ action: 'reorder', questionIds: ids })
  }
  const pending = exam.questions.filter((question) => !manualClassificationComplete(question))
  const importingCount = Object.values(imports).filter((item) => ['queued', 'importing'].includes(item.status)).length
  const importErrors = Object.values(imports).filter((item) => item.status === 'error')
  const editingDisabled = busy || importingCount > 0
  return <div className="space-y-6">
    <div><h1 className="text-xl font-semibold">Criação Manual</h1><p className="mt-1 text-sm text-content-secondary">{exam.metadata.subject} · {exam.metadata.gradeYear}º ano · Prova #{examId}</p><p className="mt-2 text-sm text-content-secondary">Importe questões do banco e organize a prova na ordem desejada. Cada inclusão aciona a classificação de Bloom e INEP. Seu rascunho fica salvo a cada alteração.</p></div>
    <ManualPlanningGuideCard guide={planningGuide} academicYear={exam.metadata.academicYear ?? new Date().getFullYear()} bimester={exam.metadata.bimester} semester={planningSemester} onSemesterChange={setPlanningSemester} />
    <div className="flex flex-wrap items-center gap-3">
      <button disabled={exam.questions.length >= 30} onClick={() => setBrowserOpen(true)} className="min-h-11 rounded-lg bg-action-primary px-5 text-sm font-semibold text-action-primary-foreground disabled:opacity-50">Buscar no banco de questões</button>
      <span className="text-sm text-content-secondary">{exam.questions.length}/30 questões</span>
      <Link href="/gerar" className="text-sm underline">Voltar à geração</Link>
    </div>
    <details className="rounded-lg border border-border p-3 text-sm"><summary className="cursor-pointer">Importar pelo ID da questão</summary><form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); enqueueImport(Number(questionId)) }}><label className="flex items-center gap-2">ID no banco<input required inputMode="numeric" pattern="[0-9]+" value={questionId} onChange={(event) => setQuestionId(event.target.value)} className="rounded border border-border bg-surface p-2" /></label><button disabled={exam.questions.length + importingCount >= 30} className="rounded border border-border px-4 disabled:opacity-50">Importar</button></form></details>
    {editingDisabled && <p role="status" className="text-sm">{importingCount ? `${importingCount} questão(ões) sendo importada(s). Você pode continuar buscando no banco.` : 'Salvando alterações…'}</p>}
    {saved && <p role="status" className="text-sm text-status-success">{saved}</p>}
    {error && <p role="alert" className="rounded border border-status-danger p-3 text-sm text-status-danger">{error}</p>}
    {!exam.questions.length && <div className="rounded-xl border border-dashed border-border p-10 text-center text-content-secondary">Sua prova começa aqui. Consulte os temas do planejamento, abra o banco e clique em “Usar nesta prova” ou “Importar esta questão”.</div>}
    <ol className="space-y-4">{exam.questions.map((question, index) => <li key={question.acervoRef!.questionId} className="space-y-3 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-semibold">Questão {index + 1} <span className="text-xs font-normal text-content-muted">{question.type === 'objetiva' ? 'Objetiva' : 'Dissertativa'} · {question.acervoRef?.origin} · ID {question.acervoRef?.questionId}</span></p><div className="flex gap-2"><button aria-label={`Mover questão ${index + 1} para cima`} disabled={editingDisabled || index === 0} onClick={() => move(index, -1)} className="rounded border border-border px-3 py-2 disabled:opacity-40">↑</button><button aria-label={`Mover questão ${index + 1} para baixo`} disabled={editingDisabled || index === exam.questions.length - 1} onClick={() => move(index, 1)} className="rounded border border-border px-3 py-2 disabled:opacity-40">↓</button><button disabled={editingDisabled} onClick={() => void action({ action: 'remove', questionId: question.acervoRef!.questionId })} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-40">Remover</button></div></div>
      <div className="flex flex-wrap gap-2 text-xs">{questionProvenanceTags(question).map((label) => <span key={label} className="rounded border border-status-info-border bg-status-info-surface px-2 py-1 text-status-info-content">{label}</span>)}</div>
      <div className="whitespace-pre-wrap text-sm"><AcervoText text={question.statement} parts={question.acervoInlineContent?.statement} examId={examId} /></div>
      {/* Original media can come from staging or Drive; preserve its existing preview URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {question.image && !question.acervoInlineContent?.statement?.some((part) => part.type === 'image') && <img src={question.image.previewUrl} alt="Imagem original da questão" className="max-h-80 max-w-full object-contain" />}
      {question.alternatives && <div className="space-y-2 text-sm">{question.alternatives.map((alternative) => <div key={alternative.letter}><strong>{alternative.letter}) </strong><AcervoText text={alternative.text} parts={question.acervoInlineContent?.alternatives?.[alternative.letter]} examId={examId} /></div>)}</div>}
      <details className="text-sm"><summary className="cursor-pointer">Gabarito original</summary><p className="mt-2 whitespace-pre-wrap">{question.correctLetter ? `Alternativa ${question.correctLetter}` : question.expectedAnswer}</p></details>
      <div className="flex flex-wrap gap-2 text-xs"><span className="rounded bg-surface-muted px-2 py-1">Bloom: {question.bloomAssessment?.status === 'classified' ? question.bloomLevel : 'Pendente — serviço indisponível'}</span><span className="rounded bg-surface-muted px-2 py-1">INEP: {question.inepAssessment?.status === 'classified' ? `${question.inepAssessment.area?.description} › ${question.inepAssessment.skill?.code}` : question.inepAssessment?.status === 'not_applicable' ? 'Sem matriz aplicável à disciplina/série' : `Pendente — ${question.inepAssessment?.errorCode === 'empty_official_catalog' ? 'catálogo oficial indisponível' : 'classificação indisponível'}`}</span><span className="rounded bg-surface-muted px-2 py-1">BNCC: {question.bnccCodes.join(', ') || 'Não mapeada na fonte'}</span></div>
      {!manualClassificationComplete(question) && <button disabled={editingDisabled} onClick={() => void action({ action: 'retry', questionId: question.acervoRef!.questionId })} className="rounded border border-border px-3 py-2 text-sm disabled:opacity-40">Tentar classificar novamente</button>}
    </li>)}</ol>
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4"><p className="text-sm text-content-secondary">{pending.length ? `${pending.length} questão(ões) com classificação pendente. Use “Tentar classificar novamente”.` : 'Questões salvas. Continue para revisar e editar a prova.'}</p><button disabled={editingDisabled || !exam.questions.length || pending.length > 0} onClick={() => void action({ action: 'finish' })} className="min-h-11 rounded-lg bg-action-primary px-5 text-sm font-semibold text-action-primary-foreground disabled:opacity-50">Concluir e revisar prova</button></div>
    {browserOpen && <dialog ref={dialog} onCancel={() => setBrowserOpen(false)} className="h-[92vh] w-[96vw] max-w-none overflow-hidden rounded-xl border border-border bg-surface p-0 backdrop:bg-content-primary/50"><div className="flex h-20 items-center justify-between gap-3 border-b border-border p-3"><div><h2 className="font-semibold">Escolha as questões da prova</h2><p className="text-xs text-content-secondary">Consulte os conteúdos ao lado e use o botão de importação da questão.</p></div><button onClick={() => setBrowserOpen(false)} className="shrink-0 rounded border border-border px-4 py-2 text-sm">Fechar</button></div><div className="flex h-[calc(92vh-144px)] min-h-0 flex-col lg:flex-row"><div className="max-h-[32vh] shrink-0 overflow-y-auto border-b border-border p-3 lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r"><ManualPlanningGuideCard guide={planningGuide} academicYear={exam.metadata.academicYear ?? new Date().getFullYear()} bimester={exam.metadata.bimester} semester={planningSemester} onSemesterChange={setPlanningSemester} compact /></div><div className="min-h-0 min-w-0 flex-1">{browserError ? <p role="alert" className="p-6 text-status-danger">{browserError}</p> : browserHtml || browserUrl ? <iframe ref={frame} onLoad={syncImportStatus} title="Selecionar questões do banco Colégio Harmonia" sandbox={browserUrl ? 'allow-scripts allow-same-origin' : 'allow-scripts'} src={browserUrl || undefined} srcDoc={browserUrl ? undefined : browserHtml} className="h-full w-full border-0" /> : <p role="status" className="p-6">Abrindo banco de questões…</p>}</div></div><div className="flex h-16 items-center gap-3 border-t border-border px-4 text-xs"><div role="status" className="min-w-0 flex-1"><p className="font-semibold">{exam.questions.length}/30 questões adicionadas{importingCount > 0 && ` · ${importingCount} na fila`}</p><p className="mt-1 text-content-secondary">{importingCount ? 'Continue escolhendo: a importação e a classificação acontecem em segundo plano.' : 'A busca permanece aberta para você escolher a próxima questão.'}</p></div>{importErrors.length > 0 && <p role="alert" className="max-w-[45%] text-status-danger">{importErrors.length} importação(ões) não concluída(s). Use “Tentar novamente” na questão.</p>}</div></dialog>}
  </div>
}
