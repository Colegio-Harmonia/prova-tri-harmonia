'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { AlertTriangle, FileWarning, Minus, Plus, UserRound, X } from 'lucide-react'

export type AttentionPage = {
  pageId: number; uploadId: number; pageIndex: number; sheetPageNumber: number | null; sheetAssignmentId: number | null
  exceptionCode: string | null; studentName: string | null; correctionId: number | null; assignmentExamId: number | null
  imageAvailable: boolean
  createdAt: string | Date
}
type Props = { examId: number; uploadId: number; pages: AttentionPage[]; corrections: Array<{ id: number; studentName: string }>; selectedCorrection: number | ''; busy: boolean; onSelectCorrection: (id: number | '') => void; onClose: () => void; onCancel: () => void; onReplace: (assignmentId: number) => void; onMove: () => void; onAssociate: () => void }
type Issue = { key: string; code: string; studentName: string | null; correctionId: number | null; assignmentId: number | null; targetExamId: number | null; pages: AttentionPage[] }

function copy(code: string) {
  if (code === 'DUPLICATE_SHEET_SCAN') return { title: 'Leitura duplicada', description: 'Esta entrega já possui uma leitura oficial.' }
  if (code === 'SCAN_BELONGS_TO_ANOTHER_EXAM') return { title: 'Folha de outra prova', description: 'O QR pertence a outra prova.' }
  if (['QR_MISSING', 'QR_INVALID'].includes(code)) return { title: 'QR não identificado', description: 'Não foi possível ler o código de identificação desta folha.' }
  if (code === 'ASSIGNMENT_NOT_FOUND') return { title: 'Folha não encontrada', description: 'O QR foi lido, mas a folha emitida correspondente não existe mais nesta prova.' }
  if (code === 'SHEET_NOT_EMITTED') return { title: 'Folha não está emitida', description: 'O QR foi lido, mas a folha correspondente não está mais ativa para esta prova.' }
  if (code === 'PAGE_TYPE_MISMATCH') return { title: 'Página não corresponde ao modelo esperado', description: 'O QR identificou o aluno, mas esta página não tem o tipo esperado para essa posição da folha.' }
  if (code === 'LOW_QUALITY') return { title: 'Imagem com baixa qualidade', description: 'A folha foi identificada, mas a imagem pode comprometer a leitura. Confira ou envie novamente.' }
  return { title: 'Leitura precisa de conferência', description: 'Há uma informação na folha que precisa ser revisada antes da correção.' }
}

function timestamp(value: string | Date) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'horário indisponível' : date.toLocaleString('pt-BR')
}

export function ScanAttentionModal(props: Props) {
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null)
  const [zoom, setZoom] = useState(1)
  function openPreview(src: string, alt: string) { setZoom(1); setPreview({ src, alt }) }
  // A mesma entrega possui várias páginas. O modal consolida as páginas que
  // pertencem ao mesmo aluno/ocorrência em um único item de decisão.
  const issues = new Map<string, Issue>()
  for (const page of props.pages) {
    const code = page.exceptionCode
    if (!code || code === 'SUPERSEDED_BY_NEW_SCAN') continue
    const key = `${code}:${page.sheetAssignmentId ?? page.assignmentExamId ?? 'unidentified'}`
    const existing = issues.get(key)
    if (existing) existing.pages.push(page)
    else issues.set(key, { key, code, studentName: page.studentName, correctionId: page.correctionId, assignmentId: page.sheetAssignmentId, targetExamId: page.assignmentExamId, pages: [page] })
  }
  const items = [...issues.values()]
  const foreign = items.filter((item) => item.code === 'SCAN_BELONGS_TO_ANOTHER_EXAM')
  const canMove = foreign.length === 1 && foreign[0].pages.length === props.pages.length && foreign[0].targetExamId !== null

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="Revisar envio de scan">
    <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-xl">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border p-5"><div><div className="flex items-center gap-2 text-amber-800"><AlertTriangle size={20}/><h2 className="text-lg font-semibold">Revisar envio #{props.uploadId}</h2></div><p className="mt-1 text-sm text-content-secondary">{items.length} ocorrência{items.length === 1 ? '' : 's'} encontrada{items.length === 1 ? '' : 's'} em {props.pages.length} folha(s).</p></div><button type="button" onClick={props.onClose} disabled={props.busy} className="text-sm text-content-muted">Fechar</button></div>
      <div className="min-h-0 space-y-3 overflow-y-auto p-5">
        {items.map((item) => {
          const text = copy(item.code); const duplicate = item.code === 'DUPLICATE_SHEET_SCAN'; const unidentified = !item.correctionId && !item.studentName && !duplicate && item.code !== 'SCAN_BELONGS_TO_ANOTHER_EXAM'; const reviewable = item.correctionId && !duplicate && item.code !== 'SCAN_BELONGS_TO_ANOTHER_EXAM'
          const firstPage = item.pages[0]
          return <article key={item.key} className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><div className="flex flex-wrap items-start justify-between gap-2"><div className="flex items-center gap-2 font-semibold"><FileWarning size={16}/>{text.title}</div><span className="rounded-full border border-amber-300 px-2 py-0.5 text-xs">{item.pages.length} folha{item.pages.length === 1 ? '' : 's'}</span></div><p className="mt-2 text-amber-900">{text.description}</p><p className="mt-2 rounded border border-amber-200 bg-white/70 px-2 py-1 text-xs text-amber-950"><strong>Scan #{firstPage.uploadId}</strong> · página do envio {firstPage.pageIndex} · ID da página {firstPage.pageId}{firstPage.sheetPageNumber ? ` · folha ${firstPage.sheetPageNumber}` : ''} · erro {item.code} · {timestamp(firstPage.createdAt)}{item.studentName ? ` · ${item.studentName}` : ''}</p>{item.pages.some((page) => page.imageAvailable) && <div className="mt-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-900">Folha enviada — confira antes de associar</p><div className="grid gap-3 sm:grid-cols-2">{item.pages.filter((page) => page.imageAvailable).map((page) => <button key={page.pageId} type="button" onClick={() => openPreview(`/api/exams/${props.examId}/scan-pages/${page.pageId}/image`, `Folha escaneada — página ${page.pageIndex}`)} className="overflow-hidden rounded border border-amber-300 bg-white text-left hover:border-harmonia-green"><Image unoptimized src={`/api/exams/${props.examId}/scan-pages/${page.pageId}/image`} width={500} height={700} className="h-44 w-full object-contain" alt={`Folha escaneada, página ${page.pageIndex}`} /><span className="block border-t border-amber-200 px-2 py-1 text-xs">Página {page.pageIndex} · clique para ampliar</span></button>)}</div></div>}{item.studentName && <p className="mt-2 flex items-center gap-1.5 text-amber-900"><UserRound size={15}/><strong>{item.studentName}</strong>{duplicate && <span>— esta é a correção que será substituída.</span>}</p>}{duplicate && item.correctionId && <div className="mt-3 flex flex-wrap gap-2"><Link href={`/gerar/${props.examId}/corrigir/alunos/${item.correctionId}`} className="rounded border border-amber-300 px-3 py-2 font-medium">Abrir correção de {item.studentName ?? 'aluno'}</Link><button type="button" disabled={props.busy || !item.assignmentId} onClick={() => props.onReplace(item.assignmentId!)} className="rounded bg-harmonia-green px-3 py-2 font-medium text-white disabled:opacity-50">Substituir scan de {item.studentName ?? 'aluno'}</button></div>}{reviewable && <div className="mt-3 flex flex-wrap gap-2"><Link href={`/gerar/${props.examId}/corrigir/alunos/${item.correctionId}`} className="rounded border border-amber-300 px-3 py-2 font-medium">Abrir correção de {item.studentName}</Link><button type="button" disabled={props.busy} onClick={props.onCancel} className="rounded border border-red-300 px-3 py-2 font-medium text-red-700 disabled:opacity-50">Excluir este scan</button></div>}{unidentified && <div className="mt-3 flex flex-wrap gap-2"><select value={props.selectedCorrection} onChange={(event) => props.onSelectCorrection(event.target.value ? Number(event.target.value) : '')} className="rounded border border-amber-300 bg-surface px-3 py-2"><option value="">Selecionar aluno…</option>{props.corrections.map((correction) => <option key={correction.id} value={correction.id}>{correction.studentName}</option>)}</select><button type="button" disabled={props.busy || !props.selectedCorrection} onClick={props.onAssociate} className="rounded bg-harmonia-green px-3 py-2 font-medium text-white disabled:opacity-50">Associar aluno</button></div>}</article>
        })}
        {canMove && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">Todo o envio pertence à prova #{foreign[0].targetExamId}</p><button type="button" disabled={props.busy} onClick={props.onMove} className="mt-3 rounded bg-harmonia-green px-3 py-2 font-medium text-white disabled:opacity-50">Mover envio para a prova correta</button></div>}
      </div>
      {preview && <div role="dialog" aria-modal="true" className="fixed inset-0 z-[60] grid place-items-center bg-black/85 p-3 sm:p-6" onClick={() => setPreview(null)}><div className="flex h-full w-full max-w-6xl min-h-0 flex-col" onClick={(event) => event.stopPropagation()}><div className="mb-3 flex shrink-0 items-center justify-between gap-3 text-white"><p className="truncate text-sm font-medium">{preview.alt}</p><div className="flex shrink-0 items-center gap-2"><button type="button" className="rounded bg-white/15 p-2" onClick={() => setZoom((value) => Math.max(.5, value - .25))} aria-label="Diminuir zoom"><Minus size={18}/></button><span className="w-10 text-center text-xs">{Math.round(zoom * 100)}%</span><button type="button" className="rounded bg-white/15 p-2" onClick={() => setZoom((value) => Math.min(3, value + .25))} aria-label="Aumentar zoom"><Plus size={18}/></button><button type="button" className="rounded bg-white/15 p-2" onClick={() => setZoom(1)}>100%</button><button type="button" className="rounded bg-white/15 p-2" onClick={() => setPreview(null)} aria-label="Fechar"><X size={18}/></button></div></div><div className="min-h-0 flex-1 overflow-auto rounded bg-black/30 p-2"><div className="mx-auto" style={{ width: `${Math.max(55, zoom * 100)}%`, minWidth: zoom > 1 ? `${zoom * 900}px` : undefined }}><Image unoptimized src={preview.src} width={1800} height={2200} alt={preview.alt} className="h-auto w-full" /></div></div></div></div>}
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border p-4"><button type="button" disabled={props.busy} onClick={props.onClose} className="rounded border border-border px-3 py-2 text-sm font-medium">Cancelar</button><button type="button" disabled={props.busy} onClick={props.onCancel} className="rounded border border-red-300 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50">Cancelar este envio</button></div>
    </div>
  </div>
}
