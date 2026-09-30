'use client'

// Bloco 5 — gráficos do relatório individual. Carregado sob demanda pela
// página (next/dynamic) para não pesar no bundle inicial do relatório.

import { useMemo, useState } from 'react'
import {
  availablePeriods, defaultPeriod, formatPercentPt, heatBand, interpretSkills, interpretSubjects,
  RADAR_MAX_READABLE_AXES, skillHeatmap, skillRadar, subjectRadar, type PeriodFilter, type RadarAxis,
} from '@/lib/curriculum/masteryCharts'
import { masteryLevel, type MasteryConsolidation, type StudentMasteryRow } from '@/lib/curriculum/studentMastery'
import MasteryRadar, { CategoryMarker, MarkerLegend } from './MasteryRadar'

type Props = { rows: StudentMasteryRow[]; consolidated: { bySubjectBimester: MasteryConsolidation[]; bySubject: MasteryConsolidation[] } }

const HEAT_CLASS = ['bg-surface-subtle text-content-muted', 'bg-status-danger-surface text-status-danger-content', 'bg-status-warning-surface text-status-warning-content', 'bg-status-info-surface text-status-info-content', 'bg-status-success-surface text-status-success-content'] as const

function periodLabel(period: PeriodFilter) {
  if (period.academicYear === null) return 'Todos os períodos'
  return period.bimester === null ? `Ano letivo ${period.academicYear} (todos os bimestres)` : `${period.bimester}º bimestre de ${period.academicYear}`
}

function EvidenceList({ axes, caption }: { axes: RadarAxis[]; caption: string }) {
  return <table className="w-full self-start text-sm">
    <caption className="sr-only">{caption}</caption>
    <thead><tr className="text-left text-xs text-content-secondary"><th scope="col" className="py-1 pr-2">Eixo</th><th scope="col" className="py-1 pr-2 text-right">Aproveit.</th><th scope="col" className="py-1 text-right">Itens / aval.</th></tr></thead>
    <tbody>{axes.map((axis) => <tr key={axis.key} className="border-t border-border">
      <td className="py-1 pr-2"><span className="flex items-center gap-1.5"><svg width="14" height="14" aria-hidden="true"><CategoryMarker category={axis.category} preliminary={axis.preliminary} x={7} y={7} size={5} /></svg><span className="font-medium text-content-primary" title={axis.description ?? undefined}>{axis.label}</span></span></td>
      <td className="py-1 pr-2 text-right tabular-nums">{formatPercentPt(axis.value)}</td>
      <td className="py-1 text-right tabular-nums text-content-secondary">{axis.itemCount} / {axis.assessmentCount}</td>
    </tr>)}</tbody>
  </table>
}

function Interpretation({ notes }: { notes: string[] }) {
  return <ul className="mt-3 space-y-1 text-sm text-content-secondary">{notes.map((note) => <li key={note}>• {note}</li>)}</ul>
}

function Heatmap({ rows, subject, academicYear }: { rows: StudentMasteryRow[]; subject: string; academicYear: number | null }) {
  const heat = skillHeatmap(rows, subject, academicYear)
  if (!heat.rows.length) return null
  return <div className="mt-4 overflow-x-auto print-avoid-break">
    <table className="text-xs">
      <caption className="mb-1 whitespace-nowrap text-left text-sm font-medium text-content-primary">Mapa de calor: habilidade × bimestre ({subject})</caption>
      <thead><tr><th scope="col" className="py-1 pr-3 text-left text-content-secondary">Habilidade</th>{heat.bimesters.map((bimester) => <th key={bimester} scope="col" className="px-2 py-1 text-content-secondary">{bimester}º bim.</th>)}</tr></thead>
      <tbody>{heat.rows.map((row) => <tr key={row.code}>
        <th scope="row" className="py-0.5 pr-3 text-left font-mono font-medium text-content-primary" title={row.description ?? undefined}>{row.code}</th>
        {row.cells.map((cell, index) => <td key={index} className={`border border-border px-2 py-0.5 text-center tabular-nums ${HEAT_CLASS[heatBand(cell?.value ?? null)]}`}>{cell ? `${formatPercentPt(cell.value)}${cell.itemCount < 3 ? '*' : ''}` : '—'}</td>)}
      </tr>)}</tbody>
    </table>
    <p className="mt-1 text-xs text-content-muted">* menos de 3 itens (leitura preliminar). Faixas: abaixo de 40%, 40–59%, 60–79%, 80% ou mais.</p>
  </div>
}

function SubjectDetail({ rows, subject, period }: { rows: StudentMasteryRow[]; subject: string; period: PeriodFilter }) {
  const axes = skillRadar(rows, subject, period, masteryLevel)
  const extensive = axes.length > RADAR_MAX_READABLE_AXES
  return <div className="print-avoid-break">
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem] print:grid-cols-[minmax(0,1fr)_7cm]">
      <MasteryRadar axes={extensive ? axes.filter((axis) => axis.value !== null) : axes} title={`Habilidades de ${subject} — ${periodLabel(period)}`} />
      <EvidenceList axes={axes} caption={`Evidências por habilidade de ${subject}`} />
    </div>
    {extensive && <p className="mt-2 text-xs text-content-muted">Com {axes.length} habilidades a teia mostra só as avaliadas; o mapa de calor abaixo traz todas.</p>}
    <Interpretation notes={interpretSkills(axes, period.bimester === null ? 'ano' : 'bimestre')} />
    {(extensive || period.bimester === null) && <Heatmap rows={rows} subject={subject} academicYear={period.academicYear} />}
  </div>
}

export default function MasteryCharts({ rows, consolidated }: Props) {
  const periods = useMemo(() => availablePeriods(rows), [rows])
  const [period, setPeriod] = useState<PeriodFilter>(() => defaultPeriod(rows))
  const subjectAxes = useMemo(() => subjectRadar(consolidated, period), [consolidated, period])
  const subjects = subjectAxes.map((axis) => axis.label)
  const [chosenSubject, setChosenSubject] = useState<string>('')
  const subject = subjects.includes(chosenSubject) ? chosenSubject : subjects[0] ?? ''
  const bimesters = periods.find((item) => item.academicYear === period.academicYear)?.bimesters ?? []

  if (!rows.length) return null
  return <section className="rounded border border-border bg-surface p-5 print-avoid-break">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-semibold text-content-primary">Progresso nas habilidades</h2>
        <p className="mt-1 text-sm text-content-secondary">Recorte: {periodLabel(period)}</p>
      </div>
      <div className="flex gap-2 print:hidden">
        <select aria-label="Ano letivo" value={period.academicYear ?? ''} onChange={(event) => setPeriod({ academicYear: Number(event.target.value), bimester: null })} className="rounded border border-border bg-canvas px-2 py-1.5 text-sm">
          {periods.map((item) => <option key={item.academicYear} value={item.academicYear}>{item.academicYear}</option>)}
        </select>
        <select aria-label="Bimestre" value={period.bimester ?? ''} onChange={(event) => setPeriod({ ...period, bimester: event.target.value ? Number(event.target.value) : null })} className="rounded border border-border bg-canvas px-2 py-1.5 text-sm">
          <option value="">Todos os bimestres</option>
          {bimesters.map((bimester) => <option key={bimester} value={bimester}>{bimester}º bimestre</option>)}
        </select>
      </div>
    </div>
    <div className="mt-3"><MarkerLegend scope={period.bimester === null ? 'ano' : 'bimestre'} /></div>

    <h3 className="mt-5 text-sm font-semibold text-content-primary">Visão geral por disciplina</h3>
    <div className="mt-2 grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem] print:grid-cols-[minmax(0,1fr)_7cm]">
      <MasteryRadar axes={subjectAxes} title={`Aproveitamento por disciplina — ${periodLabel(period)}`} />
      <EvidenceList axes={subjectAxes} caption="Evidências por disciplina" />
    </div>
    <Interpretation notes={interpretSubjects(subjectAxes)} />

    {subjects.length > 0 && <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h3 className="text-sm font-semibold text-content-primary">Detalhe por habilidade</h3>
        <select aria-label="Disciplina do detalhe" value={subject} onChange={(event) => setChosenSubject(event.target.value)} className="rounded border border-border bg-canvas px-2 py-1.5 text-sm">
          {subjects.map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      <div className="mt-2 print:hidden"><SubjectDetail rows={rows} subject={subject} period={period} /></div>
      {/* Na impressão/PDF saem todas as disciplinas, uma após a outra. */}
      <div className="hidden print:block">{subjects.map((item) => <div key={item} className="mt-6"><h3 className="text-sm font-semibold text-content-primary">Detalhe por habilidade — {item}</h3><SubjectDetail rows={rows} subject={item} period={period} /></div>)}</div>
    </>}
    <p className="mt-4 text-xs text-content-muted">Aproveitamento ponderado pelo peso das questões, com nota parcial das discursivas. “Domínio no bimestre” exige ao menos 80% em 4 itens de 2 avaliações do mesmo bimestre; na visão anual (“Domínio no ano”) as avaliações dos bimestres se somam. Abaixo de 3 itens a leitura é preliminar.</p>
  </section>
}
