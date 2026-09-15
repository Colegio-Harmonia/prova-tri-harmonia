import { ChartJSNodeCanvas } from 'chartjs-node-canvas'
import { geoNaturalEarth1, geoPath } from 'd3-geo'
import sharp from 'sharp'
import { z } from 'zod'
import { renderChemistrySmiles } from '@/lib/images/technicalVisualRender'
import type { RenderedIllustration } from './contracts'

const provenance = (generator: string) => ({ mode: 'deterministic' as const, generator, generatorVersion: '1' })
const asSvg = (svg: string, generator: string): RenderedIllustration => ({ mimeType: 'image/svg+xml', content: Buffer.from(svg), provenance: provenance(generator) })
const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)
const footer = (name: string, width = 1000, height = 600) => `<text x="${width - 28}" y="${height - 18}" text-anchor="end" font-family="Arial" font-size="12" fill="#52606d">Ilustração técnica · ${name} · v1</text>`

const chartSchema = z.object({ title: z.string().max(100).default(''), type: z.enum(['bar', 'line', 'pie']), labels: z.array(z.string().min(1).max(40)).min(2).max(20), values: z.array(z.number().finite()).min(2).max(20) }).refine((v) => v.labels.length === v.values.length)
export async function renderChart(input: unknown): Promise<RenderedIllustration> {
  const spec = chartSchema.parse(input)
  const canvas = new ChartJSNodeCanvas({ width: 1000, height: 600, backgroundColour: 'white' })
  const png = await canvas.renderToBuffer({ type: spec.type, data: { labels: spec.labels, datasets: [{ label: spec.title, data: spec.values, backgroundColor: ['#006b3f', '#53a66e', '#b7d9c1', '#f2b134', '#5d7fa3', '#bb6b6b'] }] }, options: { plugins: { title: { display: Boolean(spec.title), text: spec.title } }, animation: false, responsive: false } })
  return { mimeType: 'image/png', content: png, provenance: provenance('chart.js') }
}

const mapSchema = z.object({ title: z.string().max(100), geoJson: z.object({ type: z.literal('FeatureCollection'), features: z.array(z.object({ type: z.literal('Feature'), geometry: z.any(), properties: z.record(z.any()).optional() })).min(1).max(250) }), highlightNames: z.array(z.string()).default([]) })
export function renderMap(input: unknown): RenderedIllustration {
  const spec = mapSchema.parse(input); const projection = geoNaturalEarth1().fitSize([920, 500], spec.geoJson as never); const path = geoPath(projection)
  const highlighted = new Set(spec.highlightNames.map((name) => name.toLowerCase()))
  const shapes = spec.geoJson.features.map((feature) => `<path d="${path(feature as never) ?? ''}" fill="${highlighted.has(String(feature.properties?.name ?? '').toLowerCase()) ? '#006b3f' : '#d9e1e8'}" stroke="#52606d" stroke-width=".7"/>`).join('')
  return asSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" viewBox="0 0 1000 600"><rect width="100%" height="100%" fill="white"/><text x="40" y="42" font-family="Arial" font-size="24" font-weight="bold">${esc(spec.title)}</text><g transform="translate(40 55)">${shapes}</g>${footer('d3-geo')}</svg>`, 'd3-geo')
}

const phyloSchema = z.object({ newick: z.string().min(4).max(5000), title: z.string().max(100).default('Cladograma') })
export async function renderPhylogeny(input: unknown): Promise<RenderedIllustration> {
  const spec = phyloSchema.parse(input); const { phylotree } = await import('phylotree'); new phylotree(spec.newick)
  const tips = [...spec.newick.matchAll(/(?:\(|,)([A-Za-zÀ-ÿ0-9 _.-]+)(?=[:),])/g)].map((m) => m[1].trim()).filter(Boolean); if (tips.length < 2 || tips.length > 40) throw new Error('O cladograma precisa conter entre 2 e 40 táxons.')
  const gap = 460 / (tips.length - 1); const branches = tips.map((tip, index) => { const y = 80 + index * gap; return `<path d="M 110 300 H 360 V ${y} H 690" fill="none" stroke="#006b3f" stroke-width="3"/><text x="705" y="${y + 5}" font-family="Arial" font-size="16">${esc(tip)}</text>` }).join('')
  return asSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" viewBox="0 0 1000 600"><rect width="100%" height="100%" fill="white"/><text x="40" y="42" font-family="Arial" font-size="24" font-weight="bold">${esc(spec.title)}</text>${branches}${footer('phylotree.js')}</svg>`, 'phylotree.js')
}

const chemistrySchema = z.object({ smiles: z.string().min(1).max(500) })
export async function renderChemistry(input: unknown): Promise<RenderedIllustration> { const spec = chemistrySchema.parse(input); const png = await renderChemistrySmiles(spec.smiles); if (!png) throw new Error('Estrutura química inválida.'); return { mimeType: 'image/png', content: png, provenance: provenance('Kekule.js + RDKit') } }

const circuitSchema = z.object({ components: z.array(z.object({ kind: z.enum(['resistor', 'capacitor', 'diode', 'led', 'source', 'ground', 'line']), label: z.string().max(60).optional(), direction: z.enum(['right', 'left', 'up', 'down']).optional() })).min(1).max(40) })
export async function renderCircuit(input: unknown): Promise<RenderedIllustration> {
  const spec = circuitSchema.parse(input); const response = await fetch(`${process.env.SCHEMDRAW_URL ?? 'http://schemdraw:8000'}/render/circuit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(spec), signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error('Não foi possível renderizar o circuito.')
  return { mimeType: 'image/svg+xml', content: Buffer.from(await response.arrayBuffer()), provenance: provenance('Schemdraw') }
}
