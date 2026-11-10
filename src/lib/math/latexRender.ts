import axios from 'axios'

export { splitLatexSegments, hasLatexSegments, stripLatexDelimiters, isRenderableMath, IMAGE_ALTERNATIVE_PLACEHOLDER } from './latexSegments'
export type { TextSegment } from './latexSegments'

const CODECOGS_BASE = 'https://latex.codecogs.com'

export function buildLatexImageUrl(latex: string, dpi = 120): string {
  const full = `\\dpi{${dpi}} ${latex}`
  return `${CODECOGS_BASE}/png.image?${encodeURIComponent(full)}`
}

export async function renderLatexToBuffer(latex: string, dpi = 300): Promise<Buffer> {
  const { data } = await axios.get<ArrayBuffer>(buildLatexImageUrl(latex, dpi), {
    responseType: 'arraybuffer',
    timeout: 15_000,
    headers: { 'User-Agent': 'ProvaTri/1.0 (Colégio Harmonia; https://colegioharmonia.com.br) node-axios' },
  })
  return Buffer.from(data)
}
