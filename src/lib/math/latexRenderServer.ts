import sharp from 'sharp'
import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js'

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)
const FONT_SIZE_PT = 11
const EX_PT = FONT_SIZE_PT * 0.442
const document = mathjax.document('', { InputJax: new TeX({ packages: AllPackages }), OutputJax: new SVG({ fontCache: 'none' }) })

/** Renderização local: fórmulas impressas não dependem de um serviço externo. */
export async function renderLatexPng(latex: string, dpi = 200): Promise<Buffer> {
  const node = document.convert(latex, { display: false, em: FONT_SIZE_PT, ex: EX_PT, containerWidth: 1200 })
  const svg = adaptor.outerHTML(adaptor.tags(node, 'svg')[0])
  if (svg.includes('data-mjx-error')) throw new Error('Fórmula inválida para impressão.')
  // MathJax emite medidas em ex; converte para px antes de rasterizar.
  const normalized = svg.replace(/(width|height)="([\d.]+)ex"/g, (_, key, value) => `${key}="${Number(value) * EX_PT}"`)
  return sharp(Buffer.from(normalized), { density: dpi }).png().toBuffer()
}
