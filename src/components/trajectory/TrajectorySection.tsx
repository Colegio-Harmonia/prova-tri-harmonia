'use client'

// Bloco 6 — trajetória anual do aluno ou da turma. Mesmo componente nas duas
// telas; só muda a consulta (`studentId`/`student` ou `classroomCourseId`).

import { useEffect, useState } from 'react'
import { INTERVENTION_READING_LABEL, SKILL_CHANGE_LABEL, type SkillChangeStatus, type SubjectTrajectory } from '@/lib/curriculum/trajectory'

type Response = { mode: 'aluno' | 'turma'; studentCount: number; trajectories: SubjectTrajectory[]; rules: { minItemsPerSide: number; minChangePoints: number } }

function fmt(value: number | null, suffix = '%') {
  return value === null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${suffix}`
}
function signed(value: number | null) {
  if (value === null) return '—'
  return `${value > 0 ? '+' : ''}${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} p.p.`
}
function formatDate(iso: string) { return new Date(iso).toLocaleDateString('pt-BR') }

const STATUS_ORDER: SkillChangeStatus[] = ['avancou', 'estavel', 'regrediu', 'sem_base']
const STATUS_CLASS: Record<SkillChangeStatus, string> = {
  avancou: 'bg-status-success-surface text-status-success-content',
  estavel: 'bg-status-info-surface text-status-info-content',
  regrediu: 'bg-status-danger-surface text-status-danger-content',
  sem_base: 'bg-surface-subtle text-content-secondary',
}
// Símbolos redundantes à cor, para impressão em P&B.
const STATUS_SYMBOL: Record<SkillChangeStatus, string> = { avancou: '▲', estavel: '●', regrediu: '▼', sem_base: '○' }

function LineChart({ trajectory }: { trajectory: SubjectTrajectory }) {
  const points = trajectory.bimesters
  const width = 320
  const height = 150
  const left = 34
  const right = 12
  const top = 12
  const bottom = 28
  const x = (index: number) => points.length === 1 ? (left + width - right) / 2 : left + (index * (width - left - right)) / (points.length - 1)
  const y = (value: number) => top + ((100 - value) * (height - top - bottom)) / 100
  const valid = points.map((point, index) => ({ ...point, index })).filter((point) => point.percent !== null)
  return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Aproveitamento por bimestre em ${trajectory.subject}: ${points.map((point) => `${point.bimester}º bimestre ${fmt(point.percent)}`).join(', ')}`} className="h-auto w-full max-w-sm">
    {[0, 50, 80, 100].map((tick) => <g key={tick}>
      <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className={tick === 80 ? 'stroke-content-muted' : 'stroke-border'} strokeDasharray={tick === 80 ? '3 3' : undefined} />
      <text x={left - 4} y={y(tick) + 3} textAnchor="end" className="fill-content-muted text-[9px]">{tick}%</text>
    </g>)}
    <polyline points={valid.map((point) => `${x(point.index)},${y(point.percent!)}`).join(' ')} className="fill-none stroke-harmonia-green print:stroke-content-primary" strokeWidth={2} />
    {valid.map((point) => <g key={point.bimester}>
      <circle cx={x(point.index)} cy={y(point.percent!)} r={3.5} className="fill-harmonia-green print:fill-content-primary" />
      <text x={x(point.index)} y={y(point.percent!) - 7} textAnchor="middle" className="fill-content-primary text-[9px] font-semibold">{fmt(point.percent)}</text>
    </g>)}
    {points.map((point, index) => <text key={point.bimester} x={x(index)} y={height - 10} textAnchor="middle" className="fill-content-secondary text-[9px]">{point.bimester}º bim.</text>)}
  </svg>
}

export function SubjectCard({ trajectory, mode, rules }: { trajectory: SubjectTrajectory; mode: Response['mode']; rules: Response['rules'] }) {
  const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, trajectory.skillChanges.filter((change) => change.status === status)])) as Record<SkillChangeStatus, SubjectTrajectory['skillChanges']>
  return <div className="rounded border border-border p-4 print-avoid-break">
    <h3 className="font-semibold text-content-primary">{trajectory.subject} <span className="text-sm font-normal text-content-secondary">· {trajectory.gradeYear}º ano · {trajectory.academicYear}</span></h3>

    <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <LineChart trajectory={trajectory} />
      <table className="self-start text-sm">
        <caption className="sr-only">Comparação entre bimestres em {trajectory.subject}</caption>
        <thead><tr className="text-left text-xs text-content-secondary"><th scope="col" className="py-1 pr-2">Bimestre</th><th scope="col" className="py-1 pr-2 text-right">Aproveit.</th><th scope="col" className="py-1 pr-2 text-right">Itens</th><th scope="col" className="py-1 pr-2 text-right">Hab.</th>{mode === 'turma' && <th scope="col" className="py-1 text-right">Alunos</th>}</tr></thead>
        <tbody>{trajectory.bimesters.map((point) => <tr key={point.bimester} className="border-t border-border tabular-nums"><td className="py-1 pr-2">{point.bimester}º</td><td className="py-1 pr-2 text-right">{fmt(point.percent)}</td><td className="py-1 pr-2 text-right">{point.itemCount}</td><td className="py-1 pr-2 text-right">{point.skillCount}</td>{mode === 'turma' && <td className="py-1 text-right">{point.studentCount}</td>}</tr>)}</tbody>
      </table>
    </div>

    {trajectory.bimesters.length === 1 && <p className="mt-3 rounded bg-surface-subtle p-3 text-sm text-content-secondary">Só há correções revisadas do {trajectory.bimesters[0].bimester}º bimestre. A comparação entre bimestres, as habilidades que avançaram ou regrediram e a evolução no mesmo conjunto aparecem a partir do próximo bimestre avaliado.</p>}

    {trajectory.transitions.length > 0 && <div className="mt-4">
      <h4 className="text-sm font-semibold text-content-primary">Evolução real × mudança no que foi avaliado</h4>
      <div className="mt-2 overflow-x-auto"><table className="w-full text-sm">
        <caption className="sr-only">Decomposição da variação entre bimestres</caption>
        <thead><tr className="text-left text-xs text-content-secondary"><th scope="col" className="py-1 pr-2">Período</th><th scope="col" className="py-1 pr-2 text-right">Variação total</th><th scope="col" className="py-1 pr-2 text-right">Nas mesmas habilidades</th><th scope="col" className="py-1 pr-2 text-right">Efeito da troca de conteúdo</th><th scope="col" className="py-1">Conjunto avaliado</th></tr></thead>
        <tbody>{trajectory.transitions.map((transition) => <tr key={transition.toBimester} className="border-t border-border tabular-nums">
          <td className="py-1 pr-2">{transition.fromBimester}º → {transition.toBimester}º</td>
          <td className="py-1 pr-2 text-right">{signed(transition.totalChange)}</td>
          <td className="py-1 pr-2 text-right font-semibold">{transition.commonSkills.length ? signed(transition.sameSetChange) : 'sem habilidade em comum'}</td>
          <td className="py-1 pr-2 text-right">{signed(transition.compositionEffect)}</td>
          <td className="py-1 text-xs text-content-secondary">{transition.commonSkills.length} em comum · {transition.addedSkills.length} nova(s) · {transition.removedSkills.length} fora</td>
        </tr>)}</tbody>
      </table></div>
      <p className="mt-1 text-xs text-content-muted">“Nas mesmas habilidades” compara só o que foi avaliado nos dois bimestres: é a leitura de evolução. O efeito da troca de conteúdo é a parte da variação total que vem de avaliar habilidades diferentes.</p>
    </div>}

    {trajectory.skillChanges.length > 0 && <div className="mt-4">
      <h4 className="text-sm font-semibold text-content-primary">Habilidades avaliadas em mais de um bimestre</h4>
      <div className="mt-2 flex flex-wrap gap-2">{STATUS_ORDER.map((status) => <span key={status} className={`rounded px-2 py-1 text-xs font-medium ${STATUS_CLASS[status]}`}>{STATUS_SYMBOL[status]} {SKILL_CHANGE_LABEL[status]}: {counts[status].length}</span>)}</div>
      <ul className="mt-2 text-sm space-y-1">{STATUS_ORDER.flatMap((status) => counts[status]).map((change) => <li key={`${change.code}-${change.toBimester}`} className="tabular-nums"><span className="font-mono font-medium">{change.code}</span> <span className="text-content-secondary">{change.fromBimester}º→{change.toBimester}º: {fmt(change.fromPercent)} → {fmt(change.toPercent)} ({signed(change.change)}) · {STATUS_SYMBOL[change.status]} {SKILL_CHANGE_LABEL[change.status]}</span></li>)}</ul>
      <p className="mt-1 text-xs text-content-muted">Avanço ou regressão exige diferença de ao menos {rules.minChangePoints} pontos e {rules.minItemsPerSide} itens{mode === 'turma' ? ' por aluno' : ''} em cada bimestre.</p>
    </div>}

    {trajectory.coverage.length > 0 && trajectory.coverage.some((point) => point.plannedCumulative > 0) && <div className="mt-4">
      <h4 className="text-sm font-semibold text-content-primary">Cobertura acumulada do planejamento</h4>
      <ul className="mt-2 space-y-2">{trajectory.coverage.map((point) => <li key={point.bimester} className="text-sm">
        <div className="flex justify-between gap-2"><span>Até o {point.bimester}º bimestre</span><span className="tabular-nums text-content-secondary">{point.evaluatedCumulative} de {point.plannedCumulative} habilidades planejadas avaliadas ({fmt(point.percent)})</span></div>
        <div className="mt-1 h-2 rounded bg-surface-subtle print:border print:border-border"><div className="h-2 rounded bg-harmonia-green print:bg-content-primary" style={{ width: `${point.percent ?? 0}%` }} /></div>
      </li>)}</ul>
      {trajectory.coverage.at(-1)!.notYetEvaluated.length > 0 && <p className="mt-2 text-xs text-content-secondary">Ainda sem avaliação: {trajectory.coverage.at(-1)!.notYetEvaluated.join(', ')}.</p>}
    </div>}

    {trajectory.interventions.length > 0 && <div className="mt-4">
      <h4 className="text-sm font-semibold text-content-primary">Intervenções pedagógicas e resultados posteriores</h4>
      <div className="mt-2 overflow-x-auto"><table className="w-full text-sm">
        <caption className="sr-only">Resultados antes e depois das intervenções</caption>
        <thead><tr className="text-left text-xs text-content-secondary"><th scope="col" className="py-1 pr-2">Intervenção</th><th scope="col" className="py-1 pr-2">Registrada</th><th scope="col" className="py-1 pr-2 text-right">Antes</th><th scope="col" className="py-1 pr-2 text-right">Depois</th><th scope="col" className="py-1">Leitura</th></tr></thead>
        <tbody>{trajectory.interventions.map((item) => <tr key={item.id} className="border-t border-border">
          <td className="py-1 pr-2"><p className="font-medium text-content-primary">{item.action}</p><p className="text-xs text-content-secondary">{item.ownerName} · {item.status.replace('_', ' ')}</p></td>
          <td className="py-1 pr-2 tabular-nums">{formatDate(item.createdAt)}</td>
          <td className="py-1 pr-2 text-right tabular-nums">{fmt(item.before.percent)}<span className="block text-xs text-content-muted">{item.before.itemCount} itens</span></td>
          <td className="py-1 pr-2 text-right tabular-nums">{fmt(item.after.percent)}<span className="block text-xs text-content-muted">{item.after.itemCount} itens</span></td>
          <td className="py-1 text-xs">{INTERVENTION_READING_LABEL[item.reading]}{item.change !== null && ` (${signed(item.change)})`}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="mt-1 text-xs text-content-muted">Comparação descritiva entre avaliações anteriores e posteriores à data de registro. Não demonstra, sozinha, que a intervenção causou a mudança: conteúdo e provas também mudam no período.</p>
    </div>}
  </div>
}

export default function TrajectorySection({ query, title = 'Evolução ao longo do ano' }: { query: string; title?: string }) {
  const [data, setData] = useState<Response | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    setData(null); setError(null)
    fetch(`/api/curriculum/trajectory?${query}`).then(async (response) => {
      const body = await response.json()
      if (!active) return
      if (!response.ok || body.error) setError(body.error ?? 'Não foi possível carregar a trajetória.')
      else setData(body)
    }).catch(() => active && setError('Não foi possível carregar a trajetória.'))
    return () => { active = false }
  }, [query])

  const years = [...new Set((data?.trajectories ?? []).map((item) => item.academicYear))].sort((a, b) => b - a)
  const selectedYear = year !== null && years.includes(year) ? year : years[0] ?? null
  const visible = (data?.trajectories ?? []).filter((item) => item.academicYear === selectedYear)

  return <section className="rounded border border-border bg-surface p-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-semibold text-content-primary">{title}</h2>
        <p className="mt-1 text-sm text-content-secondary">{data?.mode === 'turma' ? `${data.studentCount} aluno(s) com correção revisada. ` : ''}Aproveitamento ponderado pelo peso das questões, bimestre a bimestre.</p>
      </div>
      {years.length > 1 && <select aria-label="Ano letivo da trajetória" value={selectedYear ?? ''} onChange={(event) => setYear(Number(event.target.value))} className="rounded border border-border bg-canvas px-2 py-1.5 text-sm print:hidden">{years.map((item) => <option key={item} value={item}>{item}</option>)}</select>}
    </div>
    {error ? <p className="mt-3 rounded bg-status-warning-surface p-3 text-sm text-status-warning-content">{error}</p>
      : !data ? <p className="mt-3 text-sm text-content-secondary">Carregando trajetória…</p>
      : !visible.length ? <p className="mt-3 text-sm text-content-secondary">Ainda não há correções revisadas para montar a trajetória.</p>
      : <div className="mt-4 space-y-4">{visible.map((trajectory) => <SubjectCard key={`${trajectory.subject}-${trajectory.gradeYear}-${trajectory.segment}`} trajectory={trajectory} mode={data.mode} rules={data.rules} />)}</div>}
  </section>
}
