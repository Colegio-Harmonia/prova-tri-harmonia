import sharp from 'sharp'
import initRDKitModule from '@rdkit/rdkit'
import { JSDOM } from 'jsdom'
import { generateStructuredContent } from '@/lib/gemini/llmClient'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { tryRenderChart } from './chartRender'

type Point = { label: string; x: number; y: number }
type Segment = { from: string; to: string }
type TechnicalVisual = {
  kind: 'chart' | 'coordinate_plane' | 'blank_coordinate_plane' | 'geometry' | 'chemistry_structure' | 'other'
  points?: Point[]
  segments?: Segment[]
  smiles?: string | null
  axisRange?: number | null
}

const TECHNICAL_VISUAL_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['chart', 'coordinate_plane', 'blank_coordinate_plane', 'geometry', 'chemistry_structure', 'other'] },
    points: { type: 'array', nullable: true, items: { type: 'object', properties: { label: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['label', 'x', 'y'] } },
    segments: { type: 'array', nullable: true, items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
    smiles: { type: 'string', nullable: true },
    axisRange: { type: 'number', nullable: true },
  },
  required: ['kind'],
}

let rdkitModule: Promise<Awaited<ReturnType<typeof initRDKitModule>>> | null = null
let jsxGraphDom: JSDOM | null = null
let jsxGraphModule: Promise<typeof import('jsxgraph')> | null = null
let jsxGraphBoardNumber = 0

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
}

// SMILES explícito embutido pelo gerador na consulta, no formato "(SMILES: CCO)".
// Quando existe, renderiza direto sem depender de nova classificação — é
// determinístico, barato e não corre o risco de o modelo "reescrever" a estrutura.
const SMILES_LITERAL = /smiles\s*[:=]\s*([A-Za-z0-9@+\-[\]()\\/=#$%*.]+)/i

export function extractSmilesLiteral(text: string | null | undefined): string | null {
  if (!text) return null
  const match = text.match(SMILES_LITERAL)
  if (!match) return null
  // Remove a pontuação de prosa que pode colar no fim ("(SMILES: CCO)."):
  // um SMILES válido não termina nesses caracteres.
  const smiles = match[1].replace(/[).,;]+$/, '')
  return smiles || null
}

async function classifyTechnicalVisual(query: string, context: string): Promise<TechnicalVisual | null> {
  const prompt = `Classifique o recurso visual de uma questão escolar. Escolha chart apenas se há dados numéricos explícitos para gráfico. Escolha blank_coordinate_plane quando a própria questão pede que o aluno desenhe/represente uma reta, função ou sistema no plano cartesiano: devolva apenas uma malha vazia, sem pontos, retas ou solução. axisRange só pode ser preenchido com um limite inteiro explícito dos dados; caso contrário use null. Escolha coordinate_plane ou geometry quando o texto trouxer coordenadas/pontos/segmentos exatos OU equações de retas JÁ DADAS COMO OBJETO DE ANÁLISE: nesses casos extraia points e segments. Para equações de retas (ex.: "3x - 2y = 6", "y = 2x + 1", "x + y = 3"), CALCULE dois pontos de cada reta (ex.: fazendo x = 0 e y = 0), devolva-os como points com rótulos ÚNICOS (ex.: A, B, C, D) e um segment ligando os dois pontos da mesma reta; inclua também o ponto de interseção quando as retas se cruzarem. Calcular pontos a partir de uma equação dada é determinístico, não é invenção. Para fotos, mapas, células, pessoas, experiências, esquemas sem dados precisos e qualquer dúvida, escolha other.

QUÍMICA ORGÂNICA (chemistry_structure): escolha este tipo para cadeias carbônicas e funções orgânicas (hidrocarbonetos, álcool, éter, aldeído, cetona, ácido carboxílico, éster, amina, amida, haleto, compostos aromáticos) quando a estrutura da molécula for relevante para a questão. Em "smiles", devolva o SMILES canônico correto:
  (a) se houver um SMILES literal no pedido ou no texto — inclusive no formato "SMILES: ..." — copie-o exatamente, sem alterar;
  (b) se o composto estiver nomeado de forma inequívoca (ex.: etanol, ácido acético, propan-2-ol, benzeno, etanoato de etila, clorometano), escreva o SMILES correto desse composto.
Nunca invente SMILES para misturas, compostos ambíguos, macromoléculas, reações complexas ou quando você não tiver certeza da estrutura — nesses casos escolha other. O SMILES é validado antes de desenhar; um erro só descarta a imagem.

Pedido: ${JSON.stringify(query)}
Questão: ${JSON.stringify(context.slice(0, 1800))}

Nunca invente coordenadas, dados, rótulos ou medidas. Responda somente no JSON solicitado.`
  const raw = await generateStructuredContent(prompt, TECHNICAL_VISUAL_SCHEMA, 'images/classify-technical-visual')
  const parsed = raw as TechnicalVisual
  return parsed && typeof parsed.kind === 'string' ? parsed : null
}

export function renderCoordinateSvg(points: Point[], segments: Segment[]): string | null {
  if (!points.length || points.length > 20 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 100 || Math.abs(point.y) > 100)) return null
  const labels = new Map(points.map((point) => [point.label, point]))
  if (labels.size !== points.length) return null
  const range = Math.max(5, ...points.flatMap((point) => [Math.abs(point.x), Math.abs(point.y)]).map(Math.ceil)) + 1
  const width = 800
  const height = 520
  const margin = 55
  const scale = Math.min((width - margin * 2) / (range * 2), (height - margin * 2) / (range * 2))
  const originX = width / 2
  const originY = height / 2
  const x = (value: number) => originX + value * scale
  const y = (value: number) => originY - value * scale
  const grid = Array.from({ length: range * 2 + 1 }, (_, index) => index - range).map((value) =>
    `<path d="M ${x(value)} ${y(-range)} V ${y(range)} M ${x(-range)} ${y(value)} H ${x(range)}" stroke="#d9e1e8" stroke-width="1"/>`,
  ).join('')
  const segmentSvg = segments.map((segment) => {
    const from = labels.get(segment.from)
    const to = labels.get(segment.to)
    return from && to ? `<line x1="${x(from.x)}" y1="${y(from.y)}" x2="${x(to.x)}" y2="${y(to.y)}" stroke="#006b3f" stroke-width="3"/>` : ''
  }).join('')
  const pointSvg = points.map((point) => `<circle cx="${x(point.x)}" cy="${y(point.y)}" r="5" fill="#003f2f"/><text x="${x(point.x) + 9}" y="${y(point.y) - 9}" font-family="Arial" font-size="18" fill="#17212b">${escapeXml(point.label)} (${point.x}, ${point.y})</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/>${grid}<path d="M ${x(-range)} ${originY} H ${x(range)} M ${originX} ${y(-range)} V ${y(range)}" stroke="#17212b" stroke-width="2"/><text x="${x(range) - 18}" y="${originY - 10}" font-family="Arial" font-size="18">x</text><text x="${originX + 10}" y="${y(range) + 20}" font-family="Arial" font-size="18">y</text>${segmentSvg}${pointSvg}</svg>`
}

/** Plano neutro: apoia a construção do aluno sem desenhar a resposta. */
export function renderBlankCoordinatePlaneSvg(axisRange: number | null | undefined): string {
  const range = Number.isFinite(axisRange) && axisRange! >= 5 && axisRange! <= 100 ? Math.ceil(axisRange!) : 10
  const width = 800
  const height = 520
  const margin = 55
  const plotWidth = width - margin * 2
  const plotHeight = height - margin * 2
  const x = (value: number) => margin + (value / range) * plotWidth
  const y = (value: number) => height - margin - (value / range) * plotHeight
  const step = range <= 10 ? 1 : range <= 25 ? 5 : 10
  const ticks = Array.from({ length: Math.floor(range / step) + 1 }, (_, index) => index * step)
  const grid = ticks.map((value) => `<path d="M ${x(value)} ${y(0)} V ${y(range)} M ${x(0)} ${y(value)} H ${x(range)}" stroke="#d9e1e8" stroke-width="1"/><text x="${x(value)}" y="${y(0) + 24}" text-anchor="middle" font-family="Arial" font-size="14" fill="#52606d">${value}</text><text x="${x(0) - 12}" y="${y(value) + 5}" text-anchor="end" font-family="Arial" font-size="14" fill="#52606d">${value}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/>${grid}<path d="M ${x(0)} ${y(0)} H ${x(range)} M ${x(0)} ${y(0)} V ${y(range)}" stroke="#17212b" stroke-width="2"/><path d="M ${x(range)} ${y(0)} l -10 -5 v 10 z M ${x(0)} ${y(range)} l -5 10 h 10 z" fill="#17212b"/><text x="${x(range) - 12}" y="${y(0) + 42}" font-family="Arial" font-size="18">x</text><text x="${x(0) - 32}" y="${y(range) + 18}" font-family="Arial" font-size="18">y</text></svg>`
}

export async function renderJsxGraphCoordinateSvg(points: Point[], segments: Segment[]): Promise<string | null> {
  try {
    if (!points.length || points.length > 20) return null
    if (!jsxGraphDom) {
      jsxGraphDom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
      const noop = () => undefined
      class HeadlessIntersectionObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return [] }
      }
      const matchMedia = () => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: noop,
        removeListener: noop,
        addEventListener: noop,
        removeEventListener: noop,
        dispatchEvent: () => false,
      })
      Object.defineProperty(jsxGraphDom.window.navigator, 'appVersion', { value: '' })
      Object.defineProperty(jsxGraphDom.window.navigator, 'userAgent', { value: '' })
      Object.assign(globalThis, {
        window: jsxGraphDom.window,
        document: jsxGraphDom.window.document,
        Element: jsxGraphDom.window.Element,
        SVGElement: jsxGraphDom.window.SVGElement,
        HTMLElement: jsxGraphDom.window.HTMLElement,
        getComputedStyle: jsxGraphDom.window.getComputedStyle,
        CSS: jsxGraphDom.window.CSS ?? { supports: () => false },
        IntersectionObserver: HeadlessIntersectionObserver,
      })
      Object.defineProperty(globalThis, 'navigator', { value: jsxGraphDom.window.navigator, configurable: true })
      Object.assign(jsxGraphDom.window, {
        matchMedia,
        IntersectionObserver: HeadlessIntersectionObserver,
        CSS: jsxGraphDom.window.CSS ?? { supports: () => false },
      })
    }
    jsxGraphModule ??= import('jsxgraph')
    const JXG = await jsxGraphModule
    const id = `technical-jsxgraph-${++jsxGraphBoardNumber}`
    const container = jsxGraphDom.window.document.createElement('div')
    container.id = id
    container.style.width = '800px'
    container.style.height = '520px'
    jsxGraphDom.window.document.body.appendChild(container)
    const range = Math.max(5, ...points.flatMap((point) => [Math.abs(point.x), Math.abs(point.y)]).map(Math.ceil)) + 1
    const board = JXG.JSXGraph.initBoard(id, { renderer: 'svg', axis: true, boundingbox: [-range, range, range, -range], showCopyright: false, showNavigation: false })
    const elements = new Map(points.map((point) => [point.label, board.create('point', [point.x, point.y], { name: point.label, size: 3, fixed: true, withLabel: true })]))
    for (const segment of segments) {
      const from = elements.get(segment.from)
      const to = elements.get(segment.to)
      if (from && to) board.create('segment', [from, to], { strokeColor: '#006b3f', strokeWidth: 3, fixed: true })
    }
    const svg = container.querySelector('svg')?.outerHTML ?? null
    JXG.JSXGraph.freeBoard(board)
    container.remove()
    return svg
  } catch (error) {
    console.warn('[technicalVisualRender] JSXGraph falhou; usando SVG de contingência:', error instanceof Error ? error.message : error)
    return null
  }
}

export async function renderChemistrySmiles(smiles: string): Promise<Buffer | null> {
  try {
    rdkitModule ??= initRDKitModule()
    const rdkit = await rdkitModule
    const molecule = rdkit.get_mol(smiles)
    if (!molecule) return null
    try {
      // RDKit valida o SMILES e produz a geometria molecular em SVG antes
      // da conversão para PNG usada no Drive e no documento.
      return sharp(Buffer.from(molecule.get_svg())).resize(700, 450, { fit: 'contain', background: 'white' }).png().toBuffer()
    } finally {
      molecule.delete()
    }
  } catch (error) {
    console.warn('[technicalVisualRender] SMILES inválido ou não renderizável pelo RDKit:', error instanceof Error ? error.message : error)
    return null
  }
}

export type TechnicalVisualResult = { source: 'grafico' | 'diagrama' | 'quimica'; buffer: Buffer } | null

/** Usa a ficha já validada, evitando uma nova inferência sobre o enunciado. */
export async function renderBlueprintVisual(blueprint: ExamQuestion['solutionBlueprint']): Promise<TechnicalVisualResult> {
  if (!blueprint || blueprint.visualSpec !== 'blank_coordinate_plane') return null
  const equationNumbers = blueprint.equations.flatMap((equation) => [...equation.matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => Number(match[0].replace(',', '.'))))
  const largestExplicitValue = Math.max(0, ...Object.values(blueprint.values), ...equationNumbers)
  const axisRange = largestExplicitValue >= 5 && largestExplicitValue <= 100 ? Math.ceil(largestExplicitValue) : null
  return { source: 'diagrama', buffer: await sharp(Buffer.from(renderBlankCoordinatePlaneSvg(axisRange))).png().toBuffer() }
}

/** Renderiza apenas visuais verificáveis. `null` preserva o fallback de busca/IA. */
export async function tryRenderTechnicalVisual(query: string, context: string): Promise<TechnicalVisualResult> {
  // Caminho determinístico: o gerador pode embutir "SMILES: ..." no imageQuery.
  // Renderiza direto, sem gastar classificação por IA nem reescrever a molécula.
  const literalSmiles = extractSmilesLiteral(`${query}\n${context}`)
  if (literalSmiles) {
    const buffer = await renderChemistrySmiles(literalSmiles)
    if (buffer) return { source: 'quimica', buffer }
  }
  let visual: TechnicalVisual | null
  try {
    visual = await classifyTechnicalVisual(query, context)
  } catch (error) {
    console.warn('[technicalVisualRender] classificação falhou:', error instanceof Error ? error.message : error)
    return null
  }
  if (!visual || visual.kind === 'other') return null
  if (visual.kind === 'chart') {
    const buffer = await tryRenderChart(query, context)
    return buffer ? { source: 'grafico', buffer } : null
  }
  if (visual.kind === 'blank_coordinate_plane') {
    return { source: 'diagrama', buffer: await sharp(Buffer.from(renderBlankCoordinatePlaneSvg(visual.axisRange))).png().toBuffer() }
  }
  if ((visual.kind === 'coordinate_plane' || visual.kind === 'geometry') && visual.points) {
    const svg = await renderJsxGraphCoordinateSvg(visual.points, visual.segments ?? []) ?? renderCoordinateSvg(visual.points, visual.segments ?? [])
    return svg ? { source: 'diagrama', buffer: await sharp(Buffer.from(svg)).png().toBuffer() } : null
  }
  if (visual.kind === 'chemistry_structure' && visual.smiles) {
    const buffer = await renderChemistrySmiles(visual.smiles)
    return buffer ? { source: 'quimica', buffer } : null
  }
  return null
}
