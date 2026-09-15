import { evaluate } from 'mathjs'
import { scaleLinear } from 'd3-scale'
import { line } from 'd3-shape'
import { functionGraphSchema, type FunctionGraphSpec, type RenderedIllustration } from './contracts'

const WIDTH = 1200
const HEIGHT = 700
const MARGIN = 72
const SAMPLE_COUNT = 480

function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' })[char]!)
}

function calculateSamples(spec: FunctionGraphSpec) {
  const [minX, maxX] = spec.domain
  const samples: Array<[number, number]> = []
  for (let index = 0; index <= SAMPLE_COUNT; index++) {
    const x = minX + ((maxX - minX) * index) / SAMPLE_COUNT
    const value = evaluate(spec.expression, { x })
    const y = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(y)) samples.push([x, y])
  }
  return samples
}

/** Renders a deterministic function graph using mathjs + D3 primitives. */
export function renderFunctionGraph(input: unknown): RenderedIllustration {
  const spec = functionGraphSchema.parse(input)
  const samples = calculateSamples(spec)
  if (samples.length < 2) throw new Error('A expressão não produziu pontos válidos no domínio informado.')
  const [minX, maxX] = spec.domain
  const observedY = samples.map(([, y]) => y)
  const [minY, maxY] = spec.range ?? [Math.min(...observedY), Math.max(...observedY)]
  const paddingY = Math.max(1, (maxY - minY || 1) * 0.1)
  const x = scaleLinear().domain([minX, maxX]).range([MARGIN, WIDTH - MARGIN])
  const y = scaleLinear().domain([minY - paddingY, maxY + paddingY]).range([HEIGHT - MARGIN, MARGIN])
  const path = line<[number, number]>().x(([value]) => x(value)).y(([, value]) => y(value))(samples)
  if (!path) throw new Error('Não foi possível desenhar a função.')
  const grid = Array.from({ length: 11 }, (_, index) => {
    const value = minX + ((maxX - minX) * index) / 10
    const horizontal = minY - paddingY + (((maxY - minY) + paddingY * 2) * index) / 10
    return `<path d="M ${x(value)} ${MARGIN} V ${HEIGHT - MARGIN} M ${MARGIN} ${y(horizontal)} H ${WIDTH - MARGIN}" stroke="#d9e1e8" stroke-width="1"/>`
  }).join('')
  const axes = `${minX <= 0 && maxX >= 0 ? `<path d="M ${x(0)} ${MARGIN} V ${HEIGHT - MARGIN}" stroke="#17212b" stroke-width="2"/>` : ''}${minY - paddingY <= 0 && maxY + paddingY >= 0 ? `<path d="M ${MARGIN} ${y(0)} H ${WIDTH - MARGIN}" stroke="#17212b" stroke-width="2"/>` : ''}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="100%" height="100%" fill="white"/>${spec.showGrid ? grid : ''}${spec.showAxes ? axes : ''}<path d="${path}" fill="none" stroke="#006b3f" stroke-width="4"/><text x="${MARGIN}" y="${HEIGHT - 22}" font-family="Arial" font-size="16" fill="#52606d">f(x) = ${escapeXml(spec.expression)}</text><text x="${WIDTH - MARGIN}" y="${HEIGHT - 22}" text-anchor="end" font-family="Arial" font-size="12" fill="#52606d">Ilustração técnica · mathjs + d3 · v1</text></svg>`
  return { mimeType: 'image/svg+xml', content: Buffer.from(svg), provenance: { mode: 'deterministic', generator: 'mathjs+d3', generatorVersion: '1' } }
}
