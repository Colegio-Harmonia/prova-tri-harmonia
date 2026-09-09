'use client'

import Link from 'next/link'
import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react'

type Page = {
  pageId: number; uploadId: number; pageIndex: number; sheetPageNumber: number | null
  exceptionCode: string | null; studentName: string | null; correctionId: number | null
  assignmentExamId: number | null; duplicateUploadId: number | null; imageAvailable: boolean
}
type CorrectionOption = { id: number; studentName: string }

export default function ScanReviewQueue({ examId }: { examId: number }) {
  const [pages, setPages] = useState<Page[]>([])
  const [corrections, setCorrections] = useState<CorrectionOption[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState<number | null>(null)
  const [associating, setAssociating] = useState<number | null>(null)
  const [replacing, setReplacing] = useState<number | null>(null)
  const [moving, setMoving] = useState<number | null>(null)
  const [selectedCorrection, setSelectedCorrection] = useState<Record<number, number>>({})
  const [error, setError] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const load = useCallback(async () => {
    const response = await fetch(`/api/exams/${examId}/scan-review-queue`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'Não foi possível atualizar.')
    setPages(data.pages); setCorrections(data.corrections ?? [])
  }, [examId])
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Erro ao carregar.')) }, [load])
  useEffect(() => {
    if (!pages.some((page) => !page.studentName && !page.exceptionCode)) return
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [pages, load])

  async function upload(event: FormEvent) {
    event.preventDefault(); if (!files.length) return
    setBusy(true); setError(null)
    try {
      for (const file of files) {
        const body = new FormData(); body.set('scan', file)
        const response = await fetch(`/api/exams/${examId}/scans`, { method: 'POST', body })
        const result = await response.json(); if (!response.ok) throw new Error(result.message ?? result.error)
      }
      setFiles([]); form.current?.reset(); await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha no upload.') } finally { setBusy(false) }
  }
  async function cancel(uploadId: number) {
    if (!confirm('Descartar este processamento? Esta ação não pode ser desfeita.')) return
    setCancelling(uploadId); setError(null)
    try {
      const response = await fetch(`/api/exams/${examId}/scans/${uploadId}/cancel`, { method: 'DELETE' })
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Não foi possível descartar o processamento.')
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível descartar o processamento.') } finally { setCancelling(null) }
  }
  async function associate(uploadId: number) {
    const correctionId = selectedCorrection[uploadId]
    if (!correctionId) { setError('Selecione o aluno que respondeu esta folha.'); return }
    setAssociating(uploadId); setError(null)
    try {
      const response = await fetch(`/api/exams/${examId}/scans/${uploadId}/associate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correctionId }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Não foi possível associar o aluno.')
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível associar o aluno.') } finally { setAssociating(null) }
  }
  async function replaceDuplicate(uploadId: number) {
    if (!confirm('Usar este novo scan no lugar da leitura anterior? A leitura anterior ficará apenas para auditoria e deixará de valer na correção.')) return
    setReplacing(uploadId); setError(null)
    try {
      const response = await fetch(`/api/exams/${examId}/scans/${uploadId}/replace-duplicate`, { method: 'POST' })
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Não foi possível substituir a leitura anterior.')
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível substituir a leitura anterior.') } finally { setReplacing(null) }
  }
  async function moveToCorrectExam(uploadId: number) {
    if (!confirm('Mover este envio para a prova identificada pelo QR e processá-lo novamente?')) return
    setMoving(uploadId); setError(null)
    try {
      const response = await fetch(`/api/exams/${examId}/scans/${uploadId}/move-to-correct-exam`, { method: 'POST' })
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Não foi possível mover o envio.')
      window.location.assign(`/gerar/${data.targetExamId}/corrigir/scans`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível mover o envio.') } finally { setMoving(null) }
  }

  const byUpload = new Map<number, Page[]>()
  for (const page of pages) byUpload.set(page.uploadId, [...(byUpload.get(page.uploadId) ?? []), page])
  return <main className="mx-auto max-w-5xl space-y-6 pb-12 text-content-primary">
    <header><Link href={`/gerar/${examId}/corrigir`} className="text-sm text-harmonia-green hover:underline">← Voltar à correção</Link><h1 className="mt-3 text-2xl font-semibold">Processamentos de scans</h1><p className="mt-1 text-sm text-content-secondary">Abra um aluno para revisar todas as questões da prova e concluir a correção.</p></header>
    <section className="rounded-xl border border-border bg-surface p-5 shadow-sm"><h2 className="font-semibold">Adicionar scans</h2><form ref={form} onSubmit={upload} className="mt-4 flex flex-wrap items-center gap-3"><input type="file" multiple accept="application/pdf,image/png,image/jpeg" onChange={(event: ChangeEvent<HTMLInputElement>) => setFiles(Array.from(event.target.files ?? []))} className="text-sm" /><button disabled={!files.length || busy} className="rounded-lg bg-harmonia-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Enviando…' : 'Enviar para leitura'}</button></form></section>
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <section><div className="flex items-baseline justify-between"><h2 className="text-lg font-semibold">Processamentos</h2><span className="text-sm text-content-secondary">{byUpload.size} envio(s)</span></div><div className="mt-3 space-y-3">{[...byUpload.entries()].map(([uploadId, group]) => {
      const first = group[0]; const reason = group.find((page) => page.exceptionCode)?.exceptionCode
      const duplicate = group.some((page) => page.exceptionCode === 'DUPLICATE_SHEET_SCAN'); const foreignPage = group.find((page) => page.exceptionCode === 'SCAN_BELONGS_TO_ANOTHER_EXAM'); const foreignExam = Boolean(foreignPage); const canMove = foreignExam && group.every((page) => page.exceptionCode === 'SCAN_BELONGS_TO_ANOTHER_EXAM' && page.assignmentExamId === foreignPage?.assignmentExamId)
      const hasFailure = group.some((page) => Boolean(page.exceptionCode)); const isPending = !hasFailure && group.some((page) => !page.studentName)
      const statusLabel = isPending ? 'Processando leitura…' : duplicate ? 'Leitura duplicada' : foreignExam ? 'Prova diferente' : hasFailure ? 'Revisão necessária' : 'Pronto para revisão'
      const statusClass = isPending ? 'bg-sky-100 text-sky-800' : duplicate || foreignExam || hasFailure ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
      return <article key={uploadId} className="rounded-xl border border-border bg-surface p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{foreignExam ? 'Folha de outra prova' : first.studentName ?? (isPending ? 'Lendo processamento…' : 'QR não identificado')}</p><p className="mt-1 text-sm text-content-secondary">Envio #{uploadId} · Prova #{examId} · {group.length} folha(s) escaneada(s)</p>{duplicate && <p className="mt-1 text-xs text-amber-700">Esta folha já possui uma leitura oficial. Escolha explicitamente se deseja substituí-la.</p>}{foreignExam && <p className="mt-1 text-xs text-amber-700">{canMove ? `O QR pertence à prova #${foreignPage?.assignmentExamId}. Esta página não pode ser associada manualmente à prova atual.` : 'O envio contém páginas de provas diferentes e foi bloqueado. Separe as folhas e envie cada prova no scanner correspondente.'}</p>}{hasFailure && !duplicate && !foreignExam && !first.correctionId && <p className="mt-1 text-xs text-amber-700">Não foi possível reconhecer o QR{reason ? ` (${reason})` : ''}. Associe o aluno manualmente para continuar.</p>}{isPending && <p className="mt-1 text-xs text-sky-700">Aguardando a leitura finalizar. O QR e as respostas podem aparecer em alguns instantes.</p>}</div><div className="flex flex-wrap items-center gap-3"><span className={`rounded-full px-3 py-1 text-xs font-medium ${statusClass}`}>{statusLabel}</span>{duplicate ? <><Link href={`/gerar/${examId}/corrigir/scans/${first.correctionId}?uploadId=${first.duplicateUploadId}`} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold">Abrir leitura existente</Link><button type="button" onClick={() => void replaceDuplicate(uploadId)} disabled={replacing === uploadId} className="rounded-lg bg-harmonia-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{replacing === uploadId ? 'Substituindo…' : 'Substituir leitura'}</button></> : foreignExam && canMove ? <button type="button" onClick={() => void moveToCorrectExam(uploadId)} disabled={moving === uploadId} className="rounded-lg bg-harmonia-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{moving === uploadId ? 'Movendo…' : 'Mover para a prova correta'}</button> : foreignExam ? null : first.correctionId ? <Link href={`/gerar/${examId}/corrigir/scans/${first.correctionId}?uploadId=${uploadId}`} className="rounded-lg bg-harmonia-green px-4 py-2 text-sm font-semibold text-white">Abrir processamento</Link> : <><select value={selectedCorrection[uploadId] ?? ''} onChange={(event) => setSelectedCorrection((current) => ({ ...current, [uploadId]: Number(event.target.value) }))} className="rounded border border-border bg-surface px-3 py-2 text-sm"><option value="">Selecionar aluno…</option>{corrections.map((correction) => <option key={correction.id} value={correction.id}>{correction.studentName}</option>)}</select><button type="button" onClick={() => void associate(uploadId)} disabled={associating === uploadId || isPending} className="rounded-lg bg-harmonia-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{associating === uploadId ? 'Associando…' : isPending ? 'Aguardando leitura…' : 'Associar aluno'}</button></>}<button type="button" onClick={() => void cancel(uploadId)} disabled={cancelling === uploadId} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50">{cancelling === uploadId ? 'Descartando…' : 'Descartar envio'}</button></div></div></article>
    })}{pages.length === 0 && <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center text-sm text-content-secondary">Nenhum processamento ainda.</div>}</div></section>
  </main>
}
