'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { SEGMENT_LABELS, SEGMENT_GRADES } from '@/config/subjects'
import { EXAM_STATUSES, type ExamKind } from '@/db/schema'
import type { Segment } from '@/types/exam'

type ExamRow = {
  id: number
  segment: string
  gradeYear: number
  academicYear: number
  subject: string
  bimester: number | null
  status: string
  examKind: ExamKind
  assessmentKind: 'padrao' | 'enem'
  scoringMethod: 'percentual' | 'tri'
  questionCount: number
  createdAt: string
  assignedTo: number | null
  assigneeName: string | null
  provaDocUrl: string | null
  gabaritoDocUrl: string | null
  mapaDocUrl: string | null
  imageSummary: { total: number; approved: number; pending: number } | null
  archivedAt: string | null
}

type FilterOptions = {
  subjects: string[]
  academicYears: number[]
  assignees: { id: number; name: string; email: string }[]
}

type Filters = {
  segment: string
  gradeYear: string
  academicYear: string
  bimester: string
  subject: string
  status: string
  assignedTo: string
}

const EMPTY_FILTERS: Filters = { segment: '', gradeYear: '', academicYear: '', bimester: '', subject: '', status: '', assignedTo: '' }

const PAGE_SIZE = 100

const STATUS_LABELS: Record<string, string> = {
  rascunho: 'Rascunho',
  atribuido: 'Atribuído',
  em_andamento: 'Em andamento',
  revisao_concluida: 'Revisão concluída',
  aprovado: 'Aprovado',
  impresso: 'Impresso',
  aplicado: 'Aplicado',
  corrigido: 'Corrigido',
}

const STATUS_COLORS: Record<string, string> = {
  rascunho: 'bg-neutral-100 text-neutral-600',
  atribuido: 'bg-blue-50 text-blue-700',
  em_andamento: 'bg-amber-50 text-amber-700',
  revisao_concluida: 'bg-teal-50 text-teal-700',
  aprovado: 'bg-harmonia-green/10 text-harmonia-green',
  impresso: 'bg-neutral-700 text-white',
  aplicado: 'bg-violet-50 text-violet-700',
  corrigido: 'bg-neutral-900 text-white',
}

const SEGMENT_SHORT_LABELS: Record<string, string> = {
  'anos-iniciais': 'Anos Iniciais',
  'anos-finais': 'Anos Finais',
  'ensino-medio': 'Ensino Médio',
}

const ALL_GRADES = [...new Set(Object.values(SEGMENT_GRADES).flat())].sort((a, b) => a - b)

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-content-secondary">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-0.5 min-h-10 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-content-primary"
      >
        <option value="">Todos</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

// Simulado com correção TRI (0-1000) precisa ser distinguível na listagem —
// avaliação padrão (0-100%) fica sem chip pra não poluir a tabela.
function TriBadge({ exam }: { exam: Pick<ExamRow, 'scoringMethod' | 'assessmentKind'> }) {
  if (exam.scoringMethod !== 'tri') return null
  return (
    <span className="ml-1.5 inline-flex rounded-full bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
      TRI · INEP
    </span>
  )
}

function ImageSummary({ summary }: { summary: ExamRow['imageSummary'] }) {
  if (!summary) return <span className="whitespace-nowrap text-xs text-content-muted">Sem imagens</span>

  if (summary.pending > 0) {
    return <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{summary.pending} pendente(s)</span>
  }

  return <span className="inline-flex rounded-full bg-harmonia-green/10 px-2 py-0.5 text-xs font-medium text-harmonia-green">{summary.total} aprovada(s)</span>
}

function ExamDocuments({ exam, isActivity }: { exam: ExamRow; isActivity: boolean }) {
  if (!exam.provaDocUrl && !exam.gabaritoDocUrl && !exam.mapaDocUrl) {
    return <span className="text-xs text-content-muted">Sem documentos</span>
  }

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {exam.provaDocUrl && <a className="break-words font-medium text-harmonia-green underline" href={exam.provaDocUrl} target="_blank" rel="noreferrer">{isActivity ? 'Atividade' : 'Prova'}</a>}
      {exam.gabaritoDocUrl && <a className="break-words font-medium text-harmonia-green underline" href={exam.gabaritoDocUrl} target="_blank" rel="noreferrer">{isActivity ? 'Gabarito comentado' : 'Gabarito'}</a>}
      {exam.mapaDocUrl && <a className="break-words font-medium text-harmonia-green underline" href={exam.mapaDocUrl} target="_blank" rel="noreferrer">{isActivity ? 'Mapa da atividade' : 'Mapa'}</a>}
    </div>
  )
}

export default function StatusList({
  currentUserId,
  isCoordenacao,
  examKind,
  collectionLabel: collectionLabelOverride,
  singularLabel: singularLabelOverride,
  archivedOnly = false,
}: {
  currentUserId: number | null
  isCoordenacao: boolean
  examKind: ExamKind
  collectionLabel?: string
  singularLabel?: string
  archivedOnly?: boolean
}) {
  const [exams, setExams] = useState<ExamRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [onlyMine, setOnlyMine] = useState(false)
  const showArchived = archivedOnly
  const [archiveActionId, setArchiveActionId] = useState<number | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ subjects: [], academicYears: [], assignees: [] })
  const isActivityCollection = examKind !== 'prova'
  const collectionLabel = collectionLabelOverride ?? (isActivityCollection ? 'atividades' : 'provas')
  const singularLabel = singularLabelOverride ?? (isActivityCollection ? 'atividade' : 'prova')

  useEffect(() => {
    fetch(`/api/exams/filters?examKind=${examKind}&archived=${showArchived}`)
      .then((res) => res.json())
      .then((data) => (data.error ? null : setFilterOptions(data)))
      .catch(() => {})
  }, [examKind, showArchived])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (filters.segment) params.set('segment', filters.segment)
    if (filters.gradeYear) params.set('gradeYear', filters.gradeYear)
    if (filters.academicYear) params.set('academicYear', filters.academicYear)
    if (filters.bimester) params.set('bimester', filters.bimester)
    if (filters.subject) params.set('subject', filters.subject)
    if (filters.status) params.set('status', filters.status)
    params.set('examKind', examKind)
    params.set('archived', String(showArchived))
    if (isCoordenacao && onlyMine && currentUserId) params.set('assignedTo', String(currentUserId))
    else if (isCoordenacao && filters.assignedTo) params.set('assignedTo', filters.assignedTo)

    fetch(`/api/exams?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error)
        else {
          setExams(data.exams)
          setTotal(data.total)
        }
      })
      .catch(() => setError('Falha ao carregar as provas.'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filters, onlyMine, isCoordenacao, currentUserId, examKind, showArchived, refreshNonce])

  // Toda mudança de filtro/toggle volta pra página 1 — senão dá pra ficar
  // numa página que não existe mais pro novo recorte (ex: filtro reduz o
  // total pra 30 itens, mas o usuário estava na página 3).
  function updateFilter(key: keyof Filters, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  async function toggleArchive(exam: ExamRow) {
    setArchiveActionId(exam.id)
    setError(null)
    try {
      const response = await fetch(`/api/exams/${exam.id}/archive`, { method: exam.archivedAt ? 'DELETE' : 'POST' })
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Não foi possível atualizar o arquivamento da prova.')
        return
      }
      setRefreshNonce((value) => value + 1)
    } catch {
      setError('Falha de rede ao atualizar o arquivamento da prova.')
    } finally {
      setArchiveActionId(null)
    }
  }

  const gradeOptions = useMemo(() => {
    const grades = filters.segment ? SEGMENT_GRADES[filters.segment as Segment] : ALL_GRADES
    return grades.map((g) => ({ value: String(g), label: `${g}º ano` }))
  }, [filters.segment])

  const hasActiveFilters = Object.values(filters).some(Boolean)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pendingForMeCount = useMemo(
    () => exams.filter((e) => e.assignedTo === currentUserId && ['atribuido', 'em_andamento'].includes(e.status)).length,
    [exams, currentUserId],
  )

  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>

  return (
    <div className="space-y-3">
      <div className="rounded border border-border bg-surface p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
          <FilterSelect
            id="exam-filter-segment"
            label="Segmento"
            value={filters.segment}
            onChange={(v) => {
              updateFilter('segment', v)
              updateFilter('gradeYear', '')
            }}
            options={(Object.keys(SEGMENT_LABELS) as Segment[]).map((s) => ({ value: s, label: SEGMENT_LABELS[s] }))}
          />
          <FilterSelect id="exam-filter-grade" label="Série" value={filters.gradeYear} onChange={(v) => updateFilter('gradeYear', v)} options={gradeOptions} />
          <FilterSelect
            id="exam-filter-year"
            label="Ano letivo"
            value={filters.academicYear}
            onChange={(v) => updateFilter('academicYear', v)}
            options={filterOptions.academicYears.map((y) => ({ value: String(y), label: String(y) }))}
          />
          <FilterSelect
            id="exam-filter-bimester"
            label="Bimestre"
            value={filters.bimester}
            onChange={(v) => updateFilter('bimester', v)}
            options={[1, 2, 3, 4].map((b) => ({ value: String(b), label: `${b}º` }))}
          />
          <FilterSelect
            id="exam-filter-subject"
            label="Disciplina"
            value={filters.subject}
            onChange={(v) => updateFilter('subject', v)}
            options={filterOptions.subjects.map((s) => ({ value: s, label: s }))}
          />
          <FilterSelect
            id="exam-filter-status"
            label="Status"
            value={filters.status}
            onChange={(v) => updateFilter('status', v)}
            options={EXAM_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))}
          />
          {isCoordenacao && (
            <FilterSelect
              id="exam-filter-assignee"
              label="Atribuído para"
              value={filters.assignedTo}
              onChange={(v) => updateFilter('assignedTo', v)}
              options={filterOptions.assignees.map((a) => ({ value: String(a.id), label: a.name }))}
            />
          )}
        </div>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              setFilters(EMPTY_FILTERS)
              setPage(1)
            }}
            className="mt-3 min-h-10 text-xs font-medium text-content-secondary underline"
          >
            Limpar filtros
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-content-secondary">{archivedOnly ? 'Todas as provas arquivadas compartilhadas com você.' : 'Arquivar remove a prova da lista de todos os envolvidos.'}</p>
        {isCoordenacao && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-h-10 items-center gap-2 text-sm text-content-secondary">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(e) => {
                setOnlyMine(e.target.checked)
                setPage(1)
              }}
            />
            Só as atribuídas a mim
          </label>
          {pendingForMeCount > 0 && (
            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
              {pendingForMeCount} pendente(s) pra você nesta página
            </span>
          )}
          </div>
        )}
      </div>

      {loading && <p role="status" aria-live="polite" className="text-sm text-neutral-500">Carregando…</p>}

      {!loading && !exams.length && <p className="text-sm text-neutral-500">Nenhuma {singularLabel} encontrada com esses filtros.</p>}

      {!loading && exams.length > 0 && (
        <>
          <div className="hidden rounded border border-border bg-surface md:block">
            <table className="w-full table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[15%]" />
                <col className="w-[10%]" />
                <col className="w-[7%]" />
                <col className="w-[8%]" />
                <col className="w-[8%]" />
                <col className="w-[10%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
                <col className="w-[16%]" />
                <col className="w-[8%]" />
              </colgroup>
              <caption className="sr-only">{collectionLabel[0].toUpperCase() + collectionLabel.slice(1)} encontradas no recorte selecionado</caption>
              <thead>
                <tr className="border-b border-border bg-surface-subtle text-xs uppercase tracking-wide text-content-secondary">
                  <th scope="col" className="px-2 py-3 font-medium">Disciplina</th>
                  <th scope="col" className="px-2 py-3 font-medium">Segmento</th>
                  <th scope="col" className="px-2 py-3 font-medium">Série</th>
                  <th scope="col" className="px-2 py-3 font-medium">Ano letivo</th>
                  <th scope="col" className="px-2 py-3 font-medium">Bimestre</th>
                  <th scope="col" className="px-2 py-3 font-medium">Status</th>
                  <th scope="col" className="px-2 py-3 font-medium">{isActivityCollection ? 'Responsável' : 'Atribuído para'}</th>
                  <th scope="col" className="px-2 py-3 font-medium">Imagens</th>
                  <th scope="col" className="px-2 py-3 font-medium">Documentos</th>
                  <th scope="col" className="px-2 py-3 font-medium text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {exams.map((exam) => (
                  <tr key={exam.id} className="hover:bg-surface-subtle">
                    <td className="px-2 py-3">
                      <Link href={`/gerar/${exam.id}/revisar`} className="font-medium hover:underline">
                        {exam.subject}
                      </Link>
                      <TriBadge exam={exam} />
                      <p className="text-xs text-content-muted">{exam.questionCount} questões · {new Date(exam.createdAt).toLocaleDateString('pt-BR')}</p>
                    </td>
                    <td className="px-2 py-3 text-content-secondary">{SEGMENT_SHORT_LABELS[exam.segment] ?? exam.segment}</td>
                    <td className="px-2 py-3 text-content-secondary">{exam.gradeYear}º ano</td>
                    <td className="px-2 py-3 text-content-secondary">{exam.academicYear}</td>
                    <td className="px-2 py-3 text-content-secondary">{exam.bimester ? `${exam.bimester}º` : '—'}</td>
                    <td className="px-2 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[exam.status] ?? 'bg-neutral-100'}`}>
                        {STATUS_LABELS[exam.status] ?? exam.status}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-content-secondary">{exam.assigneeName ?? '—'}</td>
                    <td className="px-2 py-3"><ImageSummary summary={exam.imageSummary} /></td>
                    <td className="px-2 py-3"><ExamDocuments exam={exam} isActivity={isActivityCollection} /></td>
                    <td className="px-2 py-3">
                      <button
                        type="button"
                        onClick={() => toggleArchive(exam)}
                        disabled={archiveActionId === exam.id}
                        className="min-h-9 w-full rounded border border-border px-1 py-1 text-xs font-medium text-content-secondary hover:border-harmonia-green hover:text-harmonia-green disabled:opacity-50"
                      >
                        {archiveActionId === exam.id ? 'Salvando…' : exam.archivedAt ? 'Restaurar' : 'Arquivar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {exams.map((exam) => (
              <article key={exam.id} className="rounded-lg border border-border bg-surface p-4 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link href={`/gerar/${exam.id}/revisar`} className="font-semibold text-content-primary underline-offset-2 hover:text-harmonia-green hover:underline">
                      {exam.subject}
                    </Link>
                    <TriBadge exam={exam} />
                    <p className="mt-1 text-xs text-content-muted">{exam.questionCount} questões · {new Date(exam.createdAt).toLocaleDateString('pt-BR')}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[exam.status] ?? 'bg-neutral-100'}`}>
                    {STATUS_LABELS[exam.status] ?? exam.status}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div><dt className="text-xs text-content-muted">Segmento</dt><dd className="mt-0.5 text-content-secondary">{SEGMENT_SHORT_LABELS[exam.segment] ?? exam.segment}</dd></div>
                  <div><dt className="text-xs text-content-muted">Série</dt><dd className="mt-0.5 text-content-secondary">{exam.gradeYear}º ano</dd></div>
                  <div><dt className="text-xs text-content-muted">Ano letivo</dt><dd className="mt-0.5 text-content-secondary">{exam.academicYear}</dd></div>
                  <div><dt className="text-xs text-content-muted">Bimestre</dt><dd className="mt-0.5 text-content-secondary">{exam.bimester ? `${exam.bimester}º` : '—'}</dd></div>
                  <div className="col-span-2"><dt className="text-xs text-content-muted">{isActivityCollection ? 'Responsável' : 'Atribuído para'}</dt><dd className="mt-0.5 text-content-secondary">{exam.assigneeName ?? (isActivityCollection ? 'Não definido' : 'Não atribuído')}</dd></div>
                </dl>
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
                  <div><p className="text-xs text-content-muted">Imagens</p><div className="mt-1"><ImageSummary summary={exam.imageSummary} /></div></div>
                  <div className="text-right"><p className="text-xs text-content-muted">Documentos</p><div className="mt-1"><ExamDocuments exam={exam} isActivity={isActivityCollection} /></div></div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleArchive(exam)}
                  disabled={archiveActionId === exam.id}
                  className="mt-4 min-h-10 rounded border border-border px-3 py-1.5 text-xs font-medium text-content-secondary hover:border-harmonia-green hover:text-harmonia-green disabled:opacity-50"
                >
                  {archiveActionId === exam.id ? 'Salvando…' : exam.archivedAt ? 'Restaurar esta prova' : 'Arquivar'}
                </button>
              </article>
            ))}
          </div>

          <div className="flex flex-col gap-3 text-sm text-content-secondary sm:flex-row sm:items-center sm:justify-between">
            <span>
              Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} de {total}
            </span>
            <div className="flex items-center justify-between gap-2 sm:justify-start">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="min-h-10 rounded border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
              >
                Anterior
              </button>
              <span className="text-xs">Página {page} de {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="min-h-10 rounded border border-border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
