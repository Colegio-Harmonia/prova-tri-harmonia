// Teia (radar) em SVG puro: sem biblioteca de gráficos, para caber no
// orçamento de bundle da página e sair idêntica na impressão/PDF.
// A leitura nunca depende só de cor: cada categoria tem um formato próprio.

import { formatPercentPt, RADAR_MIN_AXES, type RadarAxis, type SkillChartCategory } from '@/lib/curriculum/masteryCharts'

const SIZE = 420
const CENTER = SIZE / 2
const RADIUS = 130
const RINGS = [20, 40, 60, 80, 100]

const CATEGORY_CLASS: Record<SkillChartCategory, string> = {
  dominada: 'fill-status-success stroke-status-success',
  em_desenvolvimento: 'fill-status-warning stroke-status-warning',
  nao_avaliada: 'fill-surface stroke-content-muted',
}

/** Rótulo de "dominada" depende do recorte: no ano as avaliações dos bimestres se somam. */
export type DominanceScope = 'bimestre' | 'ano'
export function categoryLabel(category: SkillChartCategory, scope: DominanceScope) {
  return category === 'dominada' ? (scope === 'ano' ? 'Domínio no ano' : 'Domínio no bimestre') : CATEGORY_LABEL[category]
}

export const CATEGORY_LABEL: Record<SkillChartCategory, string> = {
  dominada: 'Domínio no bimestre',
  em_desenvolvimento: 'Em desenvolvimento',
  nao_avaliada: 'Ainda não avaliada',
}

function point(index: number, total: number, percent: number) {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2
  const r = (RADIUS * Math.max(0, Math.min(100, percent))) / 100
  return { x: CENTER + r * Math.cos(angle), y: CENTER + r * Math.sin(angle), angle }
}

export function CategoryMarker({ category, preliminary, x = 8, y = 8, size = 6 }: { category: SkillChartCategory; preliminary?: boolean; x?: number; y?: number; size?: number }) {
  const dash = preliminary ? '2 1.5' : undefined
  const cls = `${CATEGORY_CLASS[category]} stroke-[1.5]`
  if (category === 'em_desenvolvimento') {
    return <polygon points={`${x},${y - size} ${x + size},${y + size * 0.8} ${x - size},${y + size * 0.8}`} className={cls} strokeDasharray={dash} fillOpacity={preliminary ? 0.35 : 1} />
  }
  return <circle cx={x} cy={y} r={size * 0.85} className={cls} strokeDasharray={dash} fillOpacity={preliminary ? 0.35 : 1} />
}

export function MarkerLegend({ scope = 'bimestre' }: { scope?: DominanceScope }) {
  return <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-content-secondary" aria-label="Legenda">
    {(['dominada', 'em_desenvolvimento', 'nao_avaliada'] as const).map((category) => <li key={category} className="flex items-center gap-1.5"><svg width="16" height="16" aria-hidden="true"><CategoryMarker category={category} /></svg>{categoryLabel(category, scope)}</li>)}
    <li className="flex items-center gap-1.5"><svg width="16" height="16" aria-hidden="true"><CategoryMarker category="em_desenvolvimento" preliminary /></svg>Contorno tracejado: leitura preliminar</li>
    <li className="flex items-center gap-1.5"><svg width="22" height="16" aria-hidden="true"><line x1="1" y1="8" x2="21" y2="8" className="stroke-content-primary" strokeWidth="1.5" strokeDasharray="4 3" /></svg>Meta: domínio integral (100%)</li>
  </ul>
}

function shortLabel(label: string, total: number) {
  const max = total > 8 ? 12 : 20
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

export default function MasteryRadar({ axes, title }: { axes: RadarAxis[]; title: string }) {
  const summary = axes.map((axis) => `${axis.label}: ${axis.value === null ? 'não avaliada' : formatPercentPt(axis.value)}`).join('; ')

  // Com menos de 3 eixos não há polígono: barras horizontais comunicam melhor.
  if (axes.length < RADAR_MIN_AXES) {
    return <div role="img" aria-label={`${title}. ${summary}`} className="space-y-2">
      {axes.map((axis) => <div key={axis.key} className="text-sm">
        <div className="flex items-center gap-2"><svg width="16" height="16" aria-hidden="true"><CategoryMarker category={axis.category} preliminary={axis.preliminary} /></svg><span className="font-medium text-content-primary">{axis.label}</span><span className="text-content-secondary">{formatPercentPt(axis.value)}</span></div>
        <div className="mt-1 h-3 rounded bg-surface-subtle print:border print:border-border"><div className="h-3 rounded bg-harmonia-green print:bg-content-primary" style={{ width: `${axis.value ?? 0}%` }} /></div>
      </div>)}
    </div>
  }

  const polygon = axes.map((axis, index) => { const p = point(index, axes.length, axis.value ?? 0); return `${p.x},${p.y}` }).join(' ')
  return <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${title}. ${summary}`} className="mx-auto h-auto w-full max-w-md print:max-w-[12cm]">
    <title>{title}</title>
    {RINGS.map((ring) => <polygon key={ring} points={axes.map((_, index) => { const p = point(index, axes.length, ring); return `${p.x},${p.y}` }).join(' ')}
      className={ring === 100 ? 'fill-none stroke-content-primary' : 'fill-none stroke-border'} strokeWidth={ring === 100 ? 1.5 : 1} strokeDasharray={ring === 100 ? '5 4' : ring === 80 ? '2 3' : undefined} />)}
    {/* Marcas de escala à esquerda do eixo superior, longe do rótulo dele; a meta de 100% é explicada na legenda. */}
    {RINGS.slice(0, -1).map((ring) => <text key={ring} x={CENTER - 4} y={CENTER - (RADIUS * ring) / 100 + 3} textAnchor="end" className="fill-content-muted text-[9px]">{ring}%</text>)}
    {axes.map((axis, index) => {
      const edge = point(index, axes.length, 100)
      const label = point(index, axes.length, 118)
      const anchor = Math.abs(Math.cos(label.angle)) < 0.2 ? 'middle' : Math.cos(label.angle) > 0 ? 'start' : 'end'
      // Na metade de cima, as duas linhas sobem para não invadir a teia.
      const lift = Math.sin(label.angle) < -0.5 ? -12 : 0
      return <g key={axis.key}>
        <line x1={CENTER} y1={CENTER} x2={edge.x} y2={edge.y} className="stroke-border" />
        <text x={label.x} y={label.y + lift} textAnchor={anchor} dominantBaseline="middle" className="fill-content-primary text-[11px]">{shortLabel(axis.label, axes.length)}</text>
        <text x={label.x} y={label.y + lift + 12} textAnchor={anchor} dominantBaseline="middle" className="fill-content-secondary text-[9px]">{axis.value === null ? 'não avaliada' : `${formatPercentPt(axis.value)} · ${axis.itemCount} it.`}</text>
      </g>
    })}
    <polygon points={polygon} className="fill-harmonia-green/20 stroke-harmonia-green print:fill-content-primary/10 print:stroke-content-primary" strokeWidth={2} />
    {axes.map((axis, index) => { const p = point(index, axes.length, axis.value ?? 0); return <CategoryMarker key={axis.key} category={axis.category} preliminary={axis.preliminary} x={p.x} y={p.y} size={5} /> })}
  </svg>
}
