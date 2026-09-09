'use client'

import Link from 'next/link'
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, FileScan, LoaderCircle, Upload } from 'lucide-react'
import { StudentLink } from '@/components/alunos/StudentLink'
import { totalGrade } from '@/lib/corrections/totalGrade'
import type { CorrectionAnswer } from '@/types/correction'
import type { ScoreResult } from '@/lib/scoring/scoringPolicy'
import { ScanAttentionModal, type AttentionPage } from './ScanAttentionModal'

type Correction = { id: number; studentId: number | null; studentName: string; studentEmail: string | null; answers: CorrectionAnswer[]; status: 'pendente' | 'revisado'; scoreResult: ScoreResult | null }
type ScanPage = AttentionPage & { status: string; sheetAssignmentId: number | null; duplicateUploadId: number | null; imageAvailable: boolean; expectedPageCount: number | null }

function correctionStatus(correction: Correction, pages: ScanPage[]) {
  if (correction.status === 'revisado') return { label: 'Concluída', tone: 'bg-emerald-100 text-emerald-800', Icon: CheckCircle2 }
  const own = pages.filter((page) => page.correctionId === correction.id)
  if (!own.length) return { label: 'Esperando scan', tone: 'bg-neutral-100 text-neutral-600', Icon: Clock3 }
  if (own.some((page) => !page.exceptionCode)) return { label: 'Pendente de correção', tone: 'bg-amber-100 text-amber-800', Icon: FileScan }
  return { label: 'Revisar leitura', tone: 'bg-red-100 text-red-800', Icon: AlertTriangle }
}

function Score({ correction }: { correction: Correction }) {
  const grade = totalGrade(correction.answers)
  if (correction.status === 'revisado' && correction.scoreResult?.method === 'percentual') return <span className="text-right text-sm font-semibold">{correction.scoreResult.percent.toFixed(1)}%<small className="block font-normal text-content-muted">nota {correction.scoreResult.decimal.toFixed(2)}</small></span>
  if (correction.status === 'revisado' && correction.scoreResult?.method === 'tri') return <span className="text-right text-sm font-semibold">{correction.scoreResult.tri ? `${correction.scoreResult.tri.score} TRI` : `${correction.scoreResult.percentual.percent.toFixed(1)}%`}<small className="block font-normal text-content-muted">nota oficial</small></span>
  return <span className="text-right text-sm font-semibold">{grade === null ? '—' : grade.toFixed(1)}<small className="block font-normal text-content-muted">nota parcial</small></span>
}

export default function CorrigirExam({ examId }: { examId: number }) {
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [pages, setPages] = useState<ScanPage[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attentionUploadId, setAttentionUploadId] = useState<number | null>(null)
  const [selectedCorrection, setSelectedCorrection] = useState<number | ''>('')
  const [completedSheet, setCompletedSheet] = useState<{ correctionId: number; studentName: string; pageCount: number } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const load = useCallback(async () => {
    const [correctionsResponse, scansResponse] = await Promise.all([fetch(`/api/exams/${examId}/corrections`), fetch(`/api/exams/${examId}/scan-review-queue`)])
    const [correctionsData, scansData] = await Promise.all([correctionsResponse.json(), scansResponse.json()])
    if (!correctionsResponse.ok || !scansResponse.ok) throw new Error(correctionsData.error ?? scansData.error ?? 'Não foi possível atualizar as correções.')
    setCorrections(correctionsData.corrections ?? []); setPages(scansData.pages ?? [])
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
  const attentionUploads = useMemo(() => [...uploads.entries()].filter(([, group]) => group.some((page) => page.exceptionCode && page.exceptionCode !== 'SUPERSEDED_BY_NEW_SCAN')), [uploads])
  const processingUploads = useMemo(() => [...uploads.values()].filter((group) => group.some((page) => ['queued', 'processing', 'staged'].includes(page.status))).length, [uploads])
  const modalPages = attentionUploadId ? uploads.get(attentionUploadId) ?? [] : []
  const uploadProgress = useMemo(() => [...uploads.entries()].map(([uploadId, group]) => {
    const failed = group.some((page) => page.exceptionCode)
    const working = group.some((page) => ['queued', 'processing', 'staged'].includes(page.status))
    const done = group.every((page) => page.status === 'processed')
    return { uploadId, pages: group, label: failed ? 'Precisa de revisão' : working ? 'Identificando folha e lendo respostas…' : done ? 'Processado e salvo' : 'Aguardando processamento', tone: failed ? 'border-red-200 bg-red-50 text-red-800' : working ? 'border-sky-200 bg-sky-50 text-sky-800' : done ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-border bg-surface-raised text-content-secondary', Icon: failed ? AlertTriangle : working ? LoaderCircle : done ? CheckCircle2 : Clock3 }
  }), [uploads])
  const visibleUploadProgress = useMemo(() => uploadProgress.filter(({ pages: uploadPages, label }) => label !== 'Processado e salvo' || uploadPages.some((page) => page.exceptionCode)), [uploadProgress])

  useEffect(() => {
    const groups = new Map<number, ScanPage[]>()
    for (const page of pages) if (page.sheetAssignmentId) groups.set(page.sheetAssignmentId, [...(groups.get(page.sheetAssignmentId) ?? []), page])
    for (const [assignmentId, group] of groups) {
      const first = group[0]
      const expected = first.expectedPageCount ?? 0
      if (!first.correctionId || !first.studentName || !expected || group.length < expected || !group.every((page) => page.status === 'processed' && !page.exceptionCode)) continue
      const key = `prova-tri:sheet-completed:${examId}:${assignmentId}`
      if (window.localStorage.getItem(key)) continue
      window.localStorage.setItem(key, '1')
      setCompletedSheet({ correctionId: first.correctionId, studentName: first.studentName, pageCount: expected })
      break
    }
  }, [examId, pages])

  async function upload(event: FormEvent) {
    event.preventDefault(); if (!files.length) return
    setBusy(true); setError(null)
    try { for (const file of files) { const data = new FormData(); data.set('scan', file); const response = await fetch(`/api/exams/${examId}/scans`, { method: 'POST', body: data }); const body = await response.json(); if (!response.ok) throw new Error(body.message ?? body.error ?? 'Não foi possível enviar o scan.') }; setFiles([]); formRef.current?.reset(); await load() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível enviar o scan.') } finally { setBusy(false) }
  }
  async function action(kind: 'cancel' | 'replace' | 'move' | 'associate', assignmentId?: number) {
    if (!attentionUploadId) return
    setBusy(true); setError(null)
    try {
      let response: Response
      if (kind === 'cancel') response = await fetch(`/api/exams/${examId}/scans/${attentionUploadId}/cancel`, { method: 'DELETE' })
      else if (kind === 'replace') response = await fetch(`/api/exams/${examId}/scans/${attentionUploadId}/replace-duplicate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignmentId }) })
      else if (kind === 'move') response = await fetch(`/api/exams/${examId}/scans/${attentionUploadId}/move-to-correct-exam`, { method: 'POST' })
      else { if (!selectedCorrection) throw new Error('Selecione o aluno que respondeu esta folha.'); response = await fetch(`/api/exams/${examId}/scans/${attentionUploadId}/associate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correctionId: selectedCorrection }) }) }
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Não foi possível concluir a ação.')
      if (kind === 'move') { window.location.assign(`/gerar/${data.targetExamId}/corrigir`); return }
      setAttentionUploadId(null); setSelectedCorrection(''); await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a ação.') } finally { setBusy(false) }
  }

  return <main className="mx-auto max-w-5xl space-y-6 pb-14 text-content-primary">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><Link href={`/gerar/${examId}/revisar`} className="text-sm text-harmonia-green hover:underline">← Voltar à prova</Link><h1 className="mt-3 text-2xl font-semibold">Correções</h1><p className="mt-1 text-sm text-content-secondary">Envie as folhas e acompanhe cada aluno em um único fluxo.</p></div>{attentionUploads.length > 0 && <Link href={`/gerar/${examId}/corrigir/scans`} className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800"><AlertTriangle size={17} /> Ver fila de revisão ({attentionUploads.length})</Link>}</header>
    <section className="rounded-xl border border-border bg-surface p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Escanear provas</h2><p className="mt-1 text-sm text-content-secondary">Os arquivos são arquivados, entram na fila e cada página é identificada antes da leitura.</p></div><FileScan className="text-harmonia-green" size={28} /></div><form ref={formRef} onSubmit={upload} className="mt-4 flex flex-wrap items-center gap-3"><input type="file" multiple accept="application/pdf,image/png,image/jpeg" onChange={(event: ChangeEvent<HTMLInputElement>) => setFiles(Array.from(event.target.files ?? []))} className="max-w-full text-sm"/><button disabled={!files.length || busy} className="inline-flex items-center gap-2 rounded-lg bg-harmonia-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Upload size={16}/>{busy ? 'Enviando…' : 'Enviar scans'}</button></form>{visibleUploadProgress.length > 0 && <div className="mt-4 space-y-2 border-t border-border pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-content-muted">Acompanhamento do processamento</p>{visibleUploadProgress.slice(-8).reverse().map(({ uploadId, pages: uploadPages, label, tone, Icon }) => <div key={uploadId} className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm ${tone}`}><Icon size={16} className={label.includes('lendo') ? 'animate-spin' : ''}/><span className="font-medium">Arquivo #{uploadId}</span><span className="flex-1">{label}</span><span className="text-xs">{uploadPages.length} página{uploadPages.length === 1 ? '' : 's'}{uploadPages[0]?.studentName ? ` · ${uploadPages[0].studentName}` : ''}</span></div>)}</div>}{processingUploads > 0 && <p className="mt-3 text-xs text-content-secondary">A tela atualiza automaticamente enquanto a fila estiver trabalhando.</p>}</section>
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <section><div className="flex items-baseline justify-between"><div><h2 className="text-lg font-semibold">Alunos</h2><p className="text-sm text-content-secondary">Abra somente a correção que precisa revisar.</p></div><span className="text-sm text-content-secondary">{corrections.length} aluno(s)</span></div><div className="mt-3 space-y-3">{corrections.map((correction) => { const status = correctionStatus(correction, pages); return <article key={correction.id} className="rounded-xl border border-border bg-surface transition hover:border-harmonia-green/60"><Link href={`/gerar/${examId}/corrigir/alunos/${correction.id}`} className="flex flex-wrap items-center gap-4 p-4"><div className="min-w-0 flex-1"><p className="font-semibold"><StudentLink id={correction.studentId} name={correction.studentName}/></p>{correction.studentEmail && <p className="mt-0.5 truncate text-xs text-content-muted">{correction.studentEmail}</p>}</div><span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${status.tone}`}><status.Icon size={14}/>{status.label}</span><Score correction={correction}/><span className="text-sm font-medium text-harmonia-green">Abrir →</span></Link></article> })}{corrections.length === 0 && <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center text-sm text-content-secondary">Nenhum aluno entrou na correção ainda. Envie uma folha para começar.</div>}</div></section>
    {attentionUploadId && <ScanAttentionModal examId={examId} uploadId={attentionUploadId} pages={modalPages} corrections={corrections} selectedCorrection={selectedCorrection} busy={busy} onSelectCorrection={setSelectedCorrection} onClose={() => !busy && setAttentionUploadId(null)} onCancel={() => void action('cancel')} onReplace={(assignmentId) => void action('replace', assignmentId)} onMove={() => void action('move')} onAssociate={() => void action('associate')}/>} 
    {completedSheet && <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="Folha processada"><div className="w-full max-w-md rounded-xl bg-surface-raised p-6 shadow-xl"><h2 className="text-lg font-semibold">Folha processada</h2><p className="mt-2 text-sm text-content-secondary">A folha de <strong>{completedSheet.studentName}</strong>, com {completedSheet.pageCount} página{completedSheet.pageCount === 1 ? '' : 's'}, foi lida por completo.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setCompletedSheet(null)} className="rounded border border-border px-3 py-2 text-sm font-medium">Continuar</button><Link href={`/gerar/${examId}/corrigir/alunos/${completedSheet.correctionId}`} className="rounded bg-harmonia-green px-3 py-2 text-sm font-semibold text-white">Abrir aluno</Link></div></div></div>}
  </main>
}
