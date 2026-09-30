'use client'

import Link from 'next/link'
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, FileScan, LoaderCircle, Upload } from 'lucide-react'
import { StudentLink } from '@/components/alunos/StudentLink'
import { totalGrade } from '@/lib/corrections/totalGrade'
import type { CorrectionAnswer } from '@/types/correction'
import type { ScoreResult } from '@/lib/scoring/scoringPolicy'
import { ScanAttentionModal, type AttentionPage } from './ScanAttentionModal'
import { runWithConcurrency } from '@/lib/scan-ingest/uploadConcurrency'
import { answersWithScanEvidence, hasBlockingScanIssue, hasCompleteScanReadings, latestScanPagesForCorrection } from '@/lib/corrections/scanEvidence'
import { readJsonResponse } from '@/lib/http/readJsonResponse'
import ReturnGradesCard from './ReturnGradesCard'

type Correction = { id: number; studentId: number | null; studentName: string; studentEmail: string | null; answers: CorrectionAnswer[]; status: 'pendente' | 'revisado'; attendanceStatus: 'presente' | 'ausente'; scoreResult: ScoreResult | null }
type ScanPage = AttentionPage & { status: string; sheetAssignmentId: number | null; duplicateUploadId: number | null; imageAvailable: boolean; expectedPageCount: number | null }
type TranscriptionSummary = { correctionId: number; summary: { total: number; completed: number; queued: number; processing: number; deferred: number; needsReview: number; failed: number; active: number; canApprove: boolean } }

function correctionStatus(correction: Correction, pages: ScanPage[], transcription?: TranscriptionSummary['summary']) {
  if (correction.attendanceStatus === 'ausente') return { label: 'Ausente', tone: 'bg-slate-100 text-slate-700', Icon: Clock3 }
  if (transcription?.active) return { label: `Transcrevendo ${transcription.completed}/${transcription.total}`, tone: 'bg-sky-100 text-sky-800', Icon: LoaderCircle }
  if (transcription?.needsReview) return { label: 'Revisar transcrição', tone: 'bg-red-100 text-red-800', Icon: AlertTriangle }
  if (correction.status === 'revisado') return { label: 'Concluída', tone: 'bg-emerald-100 text-emerald-800', Icon: CheckCircle2 }
  const own = latestScanPagesForCorrection(pages, correction.id)
  if (!own.length) return { label: 'Esperando scan', tone: 'bg-neutral-100 text-neutral-600', Icon: Clock3 }
  const completePages = own.length > 0 && own.every((page) => hasCompleteScanReadings(page))
  if (completePages && !own.some(hasBlockingScanIssue)) return { label: 'Pendente de correção', tone: 'bg-amber-100 text-amber-800', Icon: FileScan }
  if (own.some((page) => ['queued', 'processing', 'staged'].includes(page.status ?? ''))) return { label: 'Lendo scan', tone: 'bg-sky-100 text-sky-800', Icon: LoaderCircle }
  return { label: 'Revisar leitura', tone: 'bg-red-100 text-red-800', Icon: AlertTriangle }
}

function Score({ correction }: { correction: Correction }) {
  if (correction.attendanceStatus === 'ausente') return <span className="text-right text-sm font-semibold text-content-muted">—<small className="block font-normal">ausente</small></span>
  const grade = totalGrade(correction.answers)
  if (correction.status === 'revisado' && correction.scoreResult?.method === 'percentual') return <span className="text-right text-sm font-semibold">{correction.scoreResult.percent.toFixed(1)}%<small className="block font-normal text-content-muted">nota {correction.scoreResult.decimal.toFixed(2)}</small></span>
  if (correction.status === 'revisado' && correction.scoreResult?.method === 'tri') return <span className="text-right text-sm font-semibold">{correction.scoreResult.tri ? `${correction.scoreResult.tri.score} TRI` : `${correction.scoreResult.percentual.percent.toFixed(1)}%`}<small className="block font-normal text-content-muted">nota oficial</small></span>
  return <span className="text-right text-sm font-semibold">{grade === null ? '—' : grade.toFixed(1)}<small className="block font-normal text-content-muted">nota parcial</small></span>
}

export default function CorrigirExam({ examId }: { examId: number }) {
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [pages, setPages] = useState<ScanPage[]>([])
  const [transcriptions, setTranscriptions] = useState<TranscriptionSummary[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attentionUploadId, setAttentionUploadId] = useState<number | null>(null)
  const [selectedCorrection, setSelectedCorrection] = useState<number | ''>('')
  const [completedSheet, setCompletedSheet] = useState<{ correctionId: number; studentName: string; pageCount: number } | null>(null)
  const [purgeModalOpen, setPurgeModalOpen] = useState(false)
  const [purgeConfirmation, setPurgeConfirmation] = useState('')
  const [purging, setPurging] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const load = useCallback(async () => {
    const [correctionsResponse, scansResponse, transcriptionsResponse] = await Promise.all([fetch(`/api/exams/${examId}/corrections`), fetch(`/api/exams/${examId}/scan-review-queue`), fetch(`/api/exams/${examId}/scan-transcriptions`)])
    const [correctionsData, scansData, transcriptionsData] = await Promise.all([
      readJsonResponse<{ corrections?: Correction[]; error?: string }>(correctionsResponse),
      readJsonResponse<{ pages?: ScanPage[]; error?: string }>(scansResponse),
      readJsonResponse<{ corrections?: TranscriptionSummary[]; error?: string }>(transcriptionsResponse),
    ])
    if (!correctionsResponse.ok || !scansResponse.ok || !transcriptionsResponse.ok) throw new Error(correctionsData.error ?? scansData.error ?? transcriptionsData.error ?? 'Não foi possível atualizar as correções.')
    setCorrections(correctionsData.corrections ?? []); setPages(scansData.pages ?? []); setTranscriptions(transcriptionsData.corrections ?? [])
  }, [examId])
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Erro ao carregar.')) }, [load])
  useEffect(() => {
    const source = new EventSource(`/api/exams/${examId}/scan-events`)
    const refresh = () => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Erro ao atualizar os scans.')) }
    source.addEventListener('scan-update', refresh)
    // Fallback para proxies que não mantêm SSE; não é o caminho normal.
    const fallback = window.setInterval(() => { if (source.readyState === EventSource.CLOSED) refresh() }, 10_000)
    return () => { source.close(); window.clearInterval(fallback) }
  }, [examId, load])

  const uploads = useMemo(() => { const groups = new Map<number, ScanPage[]>(); for (const page of pages) groups.set(page.uploadId, [...(groups.get(page.uploadId) ?? []), page]); return groups }, [pages])
  const attentionUploads = useMemo(() => [...uploads.entries()].filter(([, group]) => group.some((page) => hasBlockingScanIssue(page))), [uploads])
  const processingUploads = useMemo(() => [...uploads.values()].filter((group) => group.some((page) => ['queued', 'processing', 'staged'].includes(page.status))).length, [uploads])
  const modalPages = attentionUploadId ? uploads.get(attentionUploadId) ?? [] : []
  const transcriptionByCorrection = useMemo(() => new Map(transcriptions.map((item) => [item.correctionId, item.summary])), [transcriptions])
  const activeTranscriptionCount = useMemo(() => transcriptions.reduce((total, item) => total + item.summary.active, 0), [transcriptions])
  const transcriptionReviewCount = useMemo(() => transcriptions.reduce((total, item) => total + item.summary.needsReview, 0), [transcriptions])
  const uploadProgress = useMemo(() => [...uploads.entries()].map(([uploadId, group]) => {
    const failed = group.some((page) => hasBlockingScanIssue(page))
    const working = group.some((page) => ['queued', 'processing', 'staged'].includes(page.status))
    const done = group.every((page) => page.status === 'processed')
    const advisoryComplete = !failed && group.every((page) => page.status === 'processed' || (page.exceptionCode === 'LOW_QUALITY' && hasCompleteScanReadings(page)))
    return { uploadId, pages: group, label: failed ? 'Precisa de revisão' : working ? 'Identificando folha e lendo respostas…' : done || advisoryComplete ? 'Leitura concluída' : 'Aguardando processamento', tone: failed ? 'border-red-200 bg-red-50 text-red-800' : working ? 'border-sky-200 bg-sky-50 text-sky-800' : advisoryComplete ? 'border-amber-200 bg-amber-50 text-amber-900' : done ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-border bg-surface-raised text-content-secondary', Icon: failed ? AlertTriangle : working ? LoaderCircle : done ? CheckCircle2 : advisoryComplete ? FileScan : Clock3 }
  }), [uploads])
  const visibleUploadProgress = useMemo(() => uploadProgress.filter(({ pages: uploadPages, label }) => label !== 'Processado e salvo' || uploadPages.some((page) => page.exceptionCode)), [uploadProgress])

  useEffect(() => {
    const groups = new Map<number, ScanPage[]>()
    for (const page of pages) if (page.sheetAssignmentId) groups.set(page.sheetAssignmentId, [...(groups.get(page.sheetAssignmentId) ?? []), page])
    for (const [assignmentId, group] of groups) {
      const first = group[0]
      const expected = first.expectedPageCount ?? 0
      const transcription = first.correctionId ? transcriptionByCorrection.get(first.correctionId) : undefined
      if (!first.correctionId || !first.studentName || !expected || group.length < expected || !group.every((page) => page.status === 'processed' && !page.exceptionCode) || transcription?.active || transcription?.needsReview) continue
      const key = `prova-tri:sheet-completed:${examId}:${assignmentId}`
      if (window.localStorage.getItem(key)) continue
      window.localStorage.setItem(key, '1')
      setCompletedSheet({ correctionId: first.correctionId, studentName: first.studentName, pageCount: expected })
      break
    }
  }, [examId, pages, transcriptionByCorrection])

  async function upload(event: FormEvent) {
    event.preventDefault(); if (!files.length) return
    setBusy(true); setError(null)
    try { await runWithConcurrency(files, 3, async (file) => { const data = new FormData(); data.set('scan', file); const response = await fetch(`/api/exams/${examId}/scans`, { method: 'POST', body: data }); const body = await readJsonResponse<{ message?: string; error?: string }>(response); if (!response.ok) throw new Error(body.message ?? body.error ?? 'Não foi possível enviar o scan.') }); setFiles([]); formRef.current?.reset(); await load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível enviar o scan.') } finally { setBusy(false) }
  }
  async function action(kind: 'cancel' | 'replace' | 'move' | 'associate' | 'retry', assignmentId?: number) {
    if (!attentionUploadId) return
    setBusy(true); setError(null)
    try {
      let response: Response
      if (kind === 'cancel') response = await fetch(`/api/exams/${examId}/scans/${attentionUploadId}/cancel`, { method: 'DELETE' })
      else if (kind === 'replace') response = await fetch(`/api/exams/${examId}/scans/${attentionUploadId}/replace-duplicate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignmentId }) })
      else if (kind === 'move') response = await fetch(`/api/exams/${examId}/scans/${attentionUploadId}/move-to-correct-exam`, { method: 'POST' })
      else if (kind === 'retry') response = await fetch(`/api/exams/${examId}/scans/${attentionUploadId}/retry`, { method: 'POST' })
      else { if (!selectedCorrection) throw new Error('Selecione o aluno que respondeu esta folha.'); response = await fetch(`/api/exams/${examId}/scans/${attentionUploadId}/associate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correctionId: selectedCorrection }) }) }
      const data = await readJsonResponse<{ targetExamId?: number; error?: string }>(response); if (!response.ok) throw new Error(data.error ?? 'Não foi possível concluir a ação.')
      if (kind === 'move') { window.location.assign(`/gerar/${data.targetExamId}/corrigir`); return }
      setAttentionUploadId(null); setSelectedCorrection(''); await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a ação.') } finally { setBusy(false) }
  }

  async function purgeScans() {
    if (purgeConfirmation !== 'CONFIRMO') return
    setPurging(true); setError(null)
    try {
      const response = await fetch(`/api/exams/${examId}/purge-scans`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: purgeConfirmation }),
      })
      const data = await readJsonResponse<{ error?: string }>(response)
      if (!response.ok) throw new Error(data.error ?? 'Não foi possível limpar os scans.')
      setPurgeModalOpen(false)
      setPurgeConfirmation('')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível limpar os scans.')
    } finally {
      setPurging(false)
    }
  }

  return <main className="mx-auto max-w-5xl space-y-6 pb-14 text-content-primary">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><Link href={`/gerar/${examId}/revisar`} className="text-sm text-harmonia-green hover:underline">← Voltar à prova</Link><h1 className="mt-3 text-2xl font-semibold">Correções</h1><p className="mt-1 text-sm text-content-secondary">Envie as folhas e acompanhe cada aluno em um único fluxo.</p></div><div className="flex flex-wrap items-center justify-end gap-2"><Link href={`/gerar/${examId}/corrigir/scans`} className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold ${attentionUploads.length > 0 ? 'border-red-200 bg-red-50 text-red-800' : 'border-border bg-surface text-content-primary'}`}><FileScan size={17} /> Processamentos de scans{attentionUploads.length > 0 && ` (${attentionUploads.length} para revisar)`}</Link><button type="button" onClick={() => { setPurgeConfirmation(''); setPurgeModalOpen(true) }} disabled={busy || purging} className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"><AlertTriangle size={17} /> ! Limpar scans e notas</button></div></header>
    <ReturnGradesCard examId={examId} />
    <section className="rounded-xl border border-border bg-surface p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Escanear provas</h2><p className="mt-1 text-sm text-content-secondary">Os arquivos são arquivados, entram na fila e cada página é identificada antes da leitura.</p></div><FileScan className="text-harmonia-green" size={28} /></div><form ref={formRef} onSubmit={upload} className="mt-4 flex flex-wrap items-center gap-3"><input type="file" multiple accept="application/pdf,image/png,image/jpeg" onChange={(event: ChangeEvent<HTMLInputElement>) => setFiles(Array.from(event.target.files ?? []))} className="max-w-full text-sm"/><button disabled={!files.length || busy} className="inline-flex items-center gap-2 rounded-lg bg-harmonia-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Upload size={16}/>{busy ? 'Enviando…' : 'Enviar scans'}</button></form>{visibleUploadProgress.length > 0 && <div className="mt-4 space-y-2 border-t border-border pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-content-muted">Acompanhamento do processamento</p>{visibleUploadProgress.slice(-8).reverse().map(({ uploadId, pages: uploadPages, label, tone, Icon }) => <div key={uploadId} className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${tone}`}><Icon size={16} className={label.includes('lendo') ? 'animate-spin' : ''}/><span className="font-medium">Arquivo #{uploadId}</span><span className="flex-1">{label}</span><span className="text-xs">{uploadPages.length} página{uploadPages.length === 1 ? '' : 's'}{uploadPages[0]?.studentName ? ` · ${uploadPages[0].studentName}` : ''}</span></div>)}</div>}{processingUploads > 0 && <p className="mt-3 text-xs text-content-secondary">A tela atualiza automaticamente enquanto a fila estiver trabalhando.</p>}</section>
    {activeTranscriptionCount > 0 && <section className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sky-950"><div className="flex items-start gap-3"><LoaderCircle size={20} className="mt-0.5 shrink-0 animate-spin"/><div><p className="font-semibold">Transcrição das discursivas em andamento</p><p className="mt-1 text-sm">{activeTranscriptionCount} resposta(s) ainda estão na fila ou sendo lidas pela IA. Você pode continuar corrigindo, mas a aprovação ficará disponível quando terminar.</p></div></div></section>}
    {transcriptionReviewCount > 0 && <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950"><div className="flex items-start gap-3"><AlertTriangle size={20} className="mt-0.5 shrink-0"/><div><p className="font-semibold">Há respostas discursivas para revisar manualmente</p><p className="mt-1 text-sm">{transcriptionReviewCount} resposta(s) não foram lidas automaticamente. Abra o aluno, confira o scan e preencha a resposta antes de aprovar.</p></div></div></section>}
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <section><div className="flex items-baseline justify-between"><div><h2 className="text-lg font-semibold">Alunos</h2><p className="text-sm text-content-secondary">Abra somente a correção que precisa revisar.</p></div><span className="text-sm text-content-secondary">{corrections.length} aluno(s)</span></div><div className="mt-3 space-y-3">{corrections.map((correction) => { const status = correctionStatus(correction, pages, transcriptionByCorrection.get(correction.id)); const effectiveAnswers = answersWithScanEvidence(correction, pages); return <article key={correction.id} className="rounded-xl border border-border bg-surface transition hover:border-harmonia-green/60"><Link href={`/gerar/${examId}/corrigir/alunos/${correction.id}`} className="flex flex-wrap items-center gap-4 p-4"><div className="min-w-0 flex-1"><p className="font-semibold"><StudentLink id={correction.studentId} name={correction.studentName}/></p>{correction.studentEmail && <p className="mt-0.5 truncate text-xs text-content-muted">{correction.studentEmail}</p>}</div><span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${status.tone}`}><status.Icon size={14}/>{status.label}</span><Score correction={{ ...correction, answers: effectiveAnswers }}/><span className="text-sm font-medium text-harmonia-green">Abrir →</span></Link></article> })}{corrections.length === 0 && <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center text-sm text-content-secondary">Nenhum aluno entrou na correção ainda. Envie uma folha para começar.</div>}</div></section>
    {attentionUploadId && <ScanAttentionModal examId={examId} uploadId={attentionUploadId} pages={modalPages} corrections={corrections} selectedCorrection={selectedCorrection} busy={busy} onSelectCorrection={setSelectedCorrection} onClose={() => !busy && setAttentionUploadId(null)} onCancel={() => void action('cancel')} onRetry={() => void action('retry')} onReplace={(assignmentId) => void action('replace', assignmentId)} onMove={() => void action('move')} onAssociate={() => void action('associate')}/>}
    {purgeModalOpen && <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="purge-scans-title" aria-describedby="purge-scans-description"><div className="w-full max-w-lg rounded-xl border border-red-200 bg-surface-raised p-6 shadow-xl"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-100 text-xl font-bold text-red-700" aria-hidden="true">!</div><div><h2 id="purge-scans-title" className="text-lg font-semibold text-red-900">Apagar todos os scans e notas?</h2><p id="purge-scans-description" className="mt-2 text-sm leading-6 text-content-secondary">A prova <strong>#{examId}</strong> terá seus scans, leituras, tentativas de processamento, fila e notas removidos. As correções voltarão para pendente. As folhas emitidas e os QR codes serão preservados.</p><p className="mt-2 text-sm leading-6 text-content-secondary">Os arquivos já arquivados no Drive privado não são apagados por esta ação.</p></div></div><label htmlFor="purge-confirmation" className="mt-5 block text-sm font-medium text-content-primary">Digite <strong>CONFIRMO</strong> para continuar</label><input id="purge-confirmation" autoFocus value={purgeConfirmation} onChange={(event) => setPurgeConfirmation(event.target.value)} disabled={purging} className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-200" placeholder="CONFIRMO" autoComplete="off"/><div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => { if (!purging) { setPurgeModalOpen(false); setPurgeConfirmation('') } }} disabled={purging} className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-50">Cancelar</button><button type="button" onClick={() => void purgeScans()} disabled={purging || purgeConfirmation !== 'CONFIRMO'} className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><AlertTriangle size={16}/>{purging ? 'Limpando…' : 'Apagar scans e notas'}</button></div></div></div>}
    {completedSheet && <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="Folha identificada"><div className="w-full max-w-md rounded-xl bg-surface-raised p-6 shadow-xl"><h2 className="text-lg font-semibold">Folha identificada</h2><p className="mt-2 text-sm text-content-secondary">A folha de <strong>{completedSheet.studentName}</strong>, com {completedSheet.pageCount} página{completedSheet.pageCount === 1 ? '' : 's'}, foi identificada. Se houver respostas discursivas, a transcrição continuará em segundo plano e ficará visível na lista.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setCompletedSheet(null)} className="rounded border border-border px-3 py-2 text-sm font-medium">Continuar</button><Link href={`/gerar/${examId}/corrigir/alunos/${completedSheet.correctionId}`} className="rounded bg-harmonia-green px-3 py-2 text-sm font-semibold text-white">Abrir aluno</Link></div></div></div>}
  </main>
}
