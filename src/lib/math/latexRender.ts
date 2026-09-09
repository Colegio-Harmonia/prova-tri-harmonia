import axios from 'axios'

// Fórmulas matemáticas vêm delimitadas por $...$ no texto gerado (ver
// instrução em promptBuilder.ts) — mesma convenção do LaTeX/Markdown
// matemático, fácil da IA seguir e fácil de parsear de volta.
export type TextSegment = { type: 'text'; content: string } | { type: 'math'; latex: string }

// Marcador exibido no lugar de uma alternativa cujo texto não existe — caso
// real: questões do banco ENEM cujas alternativas são imagens (estrutura
// química, gráfico) e chegam com `text: null`. Em vez de imprimir "A) " em
// branco (ou pior, derrubar a geração), sinalizamos honestamente que o
// conteúdo veio como imagem e não está disponível como texto.
export const IMAGE_ALTERNATIVE_PLACEHOLDER = '[alternativa apresentada como imagem — indisponível no texto]'

// O texto pode chegar `null`/`undefined` na prática (o schema tipa como
// string, mas questões importadas do ENEM violam isso). Coalescemos para ''
// aqui, num ponto só, em vez de espalhar guardas por cada chamador.
function matchLatexSegments(text: string) {
  return [...text.matchAll(/\$([^$]+)\$/g)]
}

export function hasLatexSegments(text: string | null | undefined): boolean {
  return /\$[^$]+\$/.test(text ?? '')
}

export function splitLatexSegments(text: string | null | undefined): TextSegment[] {
  const safe = text ?? ''
  const segments: TextSegment[] = []
  let lastIndex = 0
  for (const match of matchLatexSegments(safe)) {
    const [full, latex] = match
    const index = match.index ?? 0
    if (index > lastIndex) segments.push({ type: 'text', content: safe.slice(lastIndex, index) })
    segments.push({ type: 'math', latex: latex.trim() })
    lastIndex = index + full.length
  }
  if (lastIndex < safe.length) segments.push({ type: 'text', content: safe.slice(lastIndex) })
  return segments
}

/** Fallback pra contextos só-texto (gabarito) — tira os $...$ sem tentar tipografar. */
export function stripLatexDelimiters(text: string | null | undefined): string {
  return (text ?? '').replace(/\$([^$]+)\$/g, '$1')
}

const CODECOGS_BASE = 'https://latex.codecogs.com'

/**
 * URL pública de renderização — dá pra usar direto como <img src>, sem
 * passar pelo servidor (o navegador busca do codecogs sozinho). Usado na
 * tela de revisão. dpi mais baixo aqui pra ficar do tamanho de uma linha
 * de texto normal, não gigante.
 */
export function buildLatexImageUrl(latex: string, dpi = 120): string {
  const full = `\\dpi{${dpi}} ${latex}`
  return `${CODECOGS_BASE}/png.image?${encodeURIComponent(full)}`
}

/** Baixa os bytes da renderização — usado só no servidor (upload pro Drive, documento final). */
export async function renderLatexToBuffer(latex: string, dpi = 300): Promise<Buffer> {
  const { data } = await axios.get<ArrayBuffer>(buildLatexImageUrl(latex, dpi), {
    responseType: 'arraybuffer',
    timeout: 15_000,
    headers: { 'User-Agent': 'ProvaTri/1.0 (Colégio Harmonia; https://colegioharmonia.com.br) node-axios' },
  })
  return Buffer.from(data)
}
