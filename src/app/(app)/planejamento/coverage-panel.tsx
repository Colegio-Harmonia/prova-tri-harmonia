'use client'

import { useEffect, useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { DataTable, type DataTableFeatures } from '@/components/ui/data-table'
import type { CoverageSkillRow, CoverageStatus } from '@/lib/curriculum/coverage'
import type { Segment } from '@/types/exam'

type Scope = { academicYear: number; segment: Segment; gradeYear: number; subject: string; bimester: number }
type CoverageResponse = {
  plan: { versionNumber: number; status: string }
  examCount: number
  rows: CoverageSkillRow[]
  plannedSkillCount: number
  assessedPlannedSkillCount: number
  pendingPlannedSkillCount: number
  outsidePlanSkillCount: number
  mappedItemCount: number
  unmappedItemCount: number
  unmappedEvaluatedAnswerCount: number
}

const STATUS_LABELS: Record<CoverageStatus, string> = {
  planejada_avaliada: 'Planejada e avaliada',
  planejada_nao_avaliada: 'Planejada, ainda não avaliada',
  fora_planejamento: 'Avaliada fora do planejamento',
}

function badgeClass(status: CoverageStatus) {
  if (status === 'planejada_avaliada') return 'bg-status-success-surface text-status-success-content'
  if (status === 'fora_planejamento') return 'bg-status-danger-surface text-status-danger-content'
  return 'bg-status-warning-surface text-status-warning-content'
}

const columnHelper = createColumnHelper<DataTableFeatures, CoverageSkillRow>()
const columns = [
  columnHelper.accessor((row) => `${row.code} ${row.description ?? ''} ${STATUS_LABELS[row.status]}`, {
    id: 'habilidade', header: 'Habilidade', cell: ({ row }) => <div><p className="font-medium">{row.original.code}</p><p className="max-w-xl text-xs text-content-secondary">{row.original.description ?? 'Descrição não informada no planejamento'}</p></div>,
  }),
  columnHelper.accessor('status', { header: 'Situação', cell: ({ getValue }) => <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${badgeClass(getValue())}`}>{STATUS_LABELS[getValue()]}</span> }),
  columnHelper.accessor('itemCount', { header: 'Itens preparados' }),
  columnHelper.accessor('evaluatedAnswerCount', { header: 'Respostas avaliadas' }),
]

function Tile({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <div className="rounded border border-border bg-surface p-4"><p className="text-sm text-content-secondary">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-content-muted">{detail}</p></div>
}

export default function CoveragePanel({ scope, refreshToken }: { scope: Scope; refreshToken: number }) {
  const { academicYear, segment, gradeYear, subject, bimester } = scope
  const [data, setData] = useState<CoverageResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true); setError(''); setData(null)
      const query = new URLSearchParams({
        academicYear: String(academicYear), segment, gradeYear: String(gradeYear), subject, bimester: String(bimester),
      })
      try {
        const response = await fetch(`/api/curriculum/coverage?${query}`, { signal: controller.signal })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? 'Não foi possível calcular a cobertura.')
        setData(body)
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível calcular a cobertura.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [academicYear, segment, gradeYear, subject, bimester, refreshToken])

  return <section className="rounded border border-border bg-canvas p-4">
    <div><h2 className="font-semibold">Cobertura do planejamento</h2><p className="mt-1 text-sm text-content-secondary">Compara as habilidades da fotografia selecionada com as questões das provas e só marca uma habilidade como avaliada quando existe resposta revisada.</p></div>
    {loading && <p className="mt-4 text-sm text-content-secondary">Calculando cobertura…</p>}
    {error && <p className="mt-4 rounded border border-border bg-surface p-3 text-sm text-content-secondary">{error}</p>}
    {data && <div className="mt-4 space-y-5">
      <p className="text-xs text-content-muted">Planejamento versão {data.plan.versionNumber} ({data.plan.status}) · {data.examCount} {data.examCount === 1 ? 'prova encontrada' : 'provas encontradas'} no recorte.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Habilidades planejadas" value={data.plannedSkillCount} detail="Denominador da cobertura" />
        <Tile label="Planejadas e avaliadas" value={data.assessedPlannedSkillCount} detail="Com resposta revisada" />
        <Tile label="Ainda não avaliadas" value={data.pendingPlannedSkillCount} detail="Sem evidência revisada" />
        <Tile label="Fora do planejamento" value={data.outsidePlanSkillCount} detail="Mapeadas nas provas, ausentes da fotografia" />
        <Tile label="Itens sem BNCC" value={data.unmappedItemCount} detail={`${data.unmappedEvaluatedAnswerCount} respostas avaliadas sem vínculo`} />
      </div>
      <div className="rounded bg-status-info-surface p-3 text-sm text-status-info-content"><strong>Como interpretar:</strong> “Itens preparados” mostra em quantas questões a habilidade aparece. “Respostas avaliadas” mostra quantas respostas revisadas sustentam a evidência. Uma questão pronta, mas ainda não corrigida, não aumenta a cobertura.</div>
      <DataTable columns={columns} data={data.rows} searchableColumnId="habilidade" searchPlaceholder="Filtrar por código, descrição ou situação..." emptyMessage="Nenhuma habilidade encontrada neste recorte." />
    </div>}
  </section>
}
