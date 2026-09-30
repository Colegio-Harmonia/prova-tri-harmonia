'use client'

import { createColumnHelper } from '@tanstack/react-table'
import { DataTable, type DataTableFeatures } from '@/components/ui/data-table'
import type { MasteryConsolidation, MasteryLevel, StudentMasteryRow } from '@/lib/curriculum/studentMastery'
import MasteryRuleReminder from '@/components/pedagogy/MasteryRuleReminder'
import MasteryCharts from './MasteryCharts'

export type MasteryResponse = {
  rows: StudentMasteryRow[]
  consolidated: { bySubjectBimester: MasteryConsolidation[]; bySubject: MasteryConsolidation[] }
  summary: { plannedSkillCount: number; observedSkillCount: number; outsidePlanCount: number; limitedBySampleCount: number; levelCounts: Record<MasteryLevel, number> }
  rules: { minItemsForReading: number; minItemsForMastery: number; minAssessmentsForMastery: number; masteryPercent: number; nearMasteryPercent: number }
}

const MASTERY_LEVEL_LABELS: Record<MasteryLevel, string> = {
  dominio: 'Domínio no bimestre',
  proximo_do_dominio: 'Próximo do domínio',
  em_desenvolvimento: 'Em desenvolvimento',
  evidencia_insuficiente: 'Evidência insuficiente',
  sem_evidencia: 'Sem evidência',
}

function masteryBadge(level: MasteryLevel) {
  if (level === 'dominio') return 'bg-status-success-surface text-status-success-content'
  if (level === 'proximo_do_dominio') return 'bg-status-info-surface text-status-info-content'
  if (level === 'em_desenvolvimento') return 'bg-status-danger-surface text-status-danger-content'
  return 'bg-status-warning-surface text-status-warning-content'
}

function formatMastery(value: number | null) { return value === null ? '—' : `${value.toLocaleString('pt-BR')}%` }

const masteryColumnHelper = createColumnHelper<DataTableFeatures, StudentMasteryRow>()
const masteryColumns = [
  masteryColumnHelper.accessor((row) => `${row.code} ${row.description ?? ''} ${row.subject} ${MASTERY_LEVEL_LABELS[row.level]}`, {
    id: 'habilidade', header: 'Habilidade', cell: ({ row }) => <div><p className="font-medium">{row.original.code}</p><p className="max-w-md text-xs text-content-secondary">{row.original.description ?? 'Descrição não informada no planejamento'}</p></div>,
  }),
  masteryColumnHelper.accessor('subject', { header: 'Disciplina' }),
  masteryColumnHelper.accessor((row) => `${row.academicYear}.${row.bimester}`, { id: 'periodo', header: 'Período', cell: ({ row }) => `${row.original.bimester}º bim. / ${row.original.academicYear}` }),
  masteryColumnHelper.accessor('masteryPercent', { header: 'Aproveitamento', cell: ({ row }) => <span>{formatMastery(row.original.masteryPercent)}{row.original.level === 'evidencia_insuficiente' && <span className="block text-xs text-content-muted">preliminar</span>}</span> }),
  masteryColumnHelper.accessor('itemCount', { header: 'Itens / avaliações', cell: ({ row }) => `${row.original.itemCount} / ${row.original.assessmentCount}` }),
  masteryColumnHelper.accessor('level', { header: 'Leitura', cell: ({ row }) => <span><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${masteryBadge(row.original.level)}`}>{MASTERY_LEVEL_LABELS[row.original.level]}</span>{row.original.limitedBySample && <span className="mt-1 block text-xs text-content-muted">limitado pela amostra</span>}</span> }),
  masteryColumnHelper.accessor('planned', { header: 'Planejada', cell: ({ getValue }) => getValue() ? 'Sim' : 'Não' }),
]

export default function MasterySection({ mastery, error: masteryError }: { mastery: MasteryResponse | null; error: string | null }) {
  return <>
      <MasteryRuleReminder />
      {mastery && <MasteryCharts rows={mastery.rows} consolidated={mastery.consolidated} />}

      <section className="rounded border border-border bg-surface p-5">
        <h2 className="font-semibold text-content-primary">Domínio das habilidades planejadas</h2>
        <p className="mt-2 text-sm text-content-secondary">Aproveitamento = pontos obtidos ÷ pontos possíveis nas questões revisadas da habilidade, respeitando o peso de cada questão e a nota parcial das discursivas.{mastery && ` Com menos de ${mastery.rules.minItemsForReading} itens a leitura fica como evidência insuficiente; domínio no bimestre exige ao menos ${mastery.rules.minItemsForMastery} itens em ${mastery.rules.minAssessmentsForMastery} avaliações do mesmo bimestre e ${mastery.rules.masteryPercent}% de aproveitamento.`}</p>
        {masteryError ? <p className="mt-3 rounded bg-status-warning-surface p-3 text-sm text-status-warning-content">{masteryError}</p> : mastery ? <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div><p className="text-xs text-content-secondary">Planejadas</p><p className="text-xl font-semibold">{mastery.summary.plannedSkillCount}</p></div>
            <div><p className="text-xs text-content-secondary">Domínio no bimestre</p><p className="text-xl font-semibold">{mastery.summary.levelCounts.dominio}</p></div>
            <div><p className="text-xs text-content-secondary">Próximo do domínio</p><p className="text-xl font-semibold">{mastery.summary.levelCounts.proximo_do_dominio}</p></div>
            <div><p className="text-xs text-content-secondary">Em desenvolvimento</p><p className="text-xl font-semibold">{mastery.summary.levelCounts.em_desenvolvimento}</p></div>
            <div><p className="text-xs text-content-secondary">Sem evidência suficiente</p><p className="text-xl font-semibold">{mastery.summary.levelCounts.sem_evidencia + mastery.summary.levelCounts.evidencia_insuficiente}</p></div>
          </div>
          {mastery.summary.limitedBySampleCount > 0 && <p className="rounded bg-status-warning-surface p-3 text-sm text-status-warning-content">{mastery.summary.limitedBySampleCount} {mastery.summary.limitedBySampleCount === 1 ? 'habilidade tem' : 'habilidades têm'} aproveitamento alto, mas ainda sem itens ou avaliações suficientes para afirmar domínio no bimestre.</p>}
          {mastery.consolidated.bySubjectBimester.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Domínio consolidado por disciplina e bimestre</caption><thead><tr className="text-left text-xs text-content-secondary"><th scope="col" className="py-1 pr-3">Disciplina</th><th scope="col" className="py-1 pr-3">Período</th><th scope="col" className="py-1 pr-3">Aproveitamento</th><th scope="col" className="py-1 pr-3">Itens / avaliações</th><th scope="col" className="py-1">Habilidades (domínio · próximo · em desenv. · sem evidência suficiente)</th></tr></thead><tbody>{[...mastery.consolidated.bySubjectBimester, ...mastery.consolidated.bySubject].map((group) => <tr key={`${group.academicYear}-${group.segment}-${group.gradeYear}-${group.subject}-${group.bimester ?? 'ano'}`} className={`border-t border-border ${group.bimester === null ? 'font-semibold' : ''}`}><td className="py-1 pr-3">{group.subject}</td><td className="py-1 pr-3">{group.bimester === null ? `Ano ${group.academicYear}` : `${group.bimester}º bim. / ${group.academicYear}`}</td><td className="py-1 pr-3">{formatMastery(group.masteryPercent)}</td><td className="py-1 pr-3">{group.itemCount} / {group.assessmentCount}</td><td className="py-1">{group.levelCounts.dominio} · {group.levelCounts.proximo_do_dominio} · {group.levelCounts.em_desenvolvimento} · {group.levelCounts.sem_evidencia + group.levelCounts.evidencia_insuficiente}</td></tr>)}</tbody></table></div>}
          {mastery.summary.outsidePlanCount > 0 && <p className="rounded bg-status-info-surface p-3 text-sm text-status-info-content">Há {mastery.summary.outsidePlanCount} {mastery.summary.outsidePlanCount === 1 ? 'habilidade avaliada' : 'habilidades avaliadas'} fora da fotografia do planejamento. Elas aparecem na tabela para conferência.</p>}
          <DataTable columns={masteryColumns} data={mastery.rows} searchableColumnId="habilidade" searchPlaceholder="Filtrar por habilidade, disciplina ou situação..." emptyMessage="Ainda não há planejamento ou evidência BNCC para este recorte." />
        </div> : <p className="mt-3 text-sm text-content-secondary">Carregando domínio por habilidade…</p>}
      </section>
  </>
}
