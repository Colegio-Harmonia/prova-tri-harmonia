export type BoldSegment = { text: string; bold: boolean }

// `**trecho**` dentro do mesmo parágrafo (pode atravessar quebra de linha
// simples, nunca linha em branco), sem espaço colado nos marcadores.
// Os marcadores não podem estar grudados em letra/dígito por fora: é isso
// que distingue ênfase de operador de potência (`2**3 + 4**2` fica intacto).
// `**` solto (sem par) também fica como está.
const BOLD_PATTERN = /(?<![\p{L}\p{N}])\*\*(?=\S)((?:[^\n]|\n(?!\s*\n))+?)(?<=\S)\*\*(?![\p{L}\p{N}])/gu

// Código (bloco entre três crases ou trecho entre crases): Markdown não
// interpreta ênfase ali, e a questão pode estar ensinando a sintaxe `**x**`.
const CODE_SPAN_PATTERN = /```[\s\S]*?```|`[^`\n]+`/g

// `2 **3** 2` casa com o padrão de ênfase, mas é potência encadeada:
// trecho só numérico, com operando numérico dos dois lados.
function isChainedExponent(text: string, start: number, end: number, inner: string): boolean {
  if (!/^[\p{N}.,()\s+\-/]+$/u.test(inner)) return false
  return /[\p{N})]\s*$/u.test(text.slice(0, start)) && /^\s*[\p{N}(]/u.test(text.slice(end))
}

/**
 * Separa um texto em trechos normais e trechos marcados com `**negrito**`,
 * já sem os asteriscos. A IA devolve ênfase em Markdown (a biblioteca de
 * TDAH pede isso explicitamente), mas nem o Google Docs nem um <p> comum
 * interpretam `**` — quem exibe o texto precisa aplicar o negrito de fato.
 */
export function splitBoldSegments(text: string | null | undefined): BoldSegment[] {
  if (!text) return []
  // Mascara o código entre crases mantendo os índices, para que um `**`
  // ali dentro nunca seja pareado com um marcador de fora.
  const masked = text.replace(CODE_SPAN_PATTERN, (span) => span.replace(/[^\n]/g, ' '))
  const segments: BoldSegment[] = []
  let last = 0
  for (const match of masked.matchAll(BOLD_PATTERN)) {
    const at = match.index ?? 0
    const end = at + match[0].length
    if (isChainedExponent(masked, at, end, match[1])) continue
    if (at > last) segments.push({ text: text.slice(last, at), bold: false })
    segments.push({ text: text.slice(at + 2, end - 2), bold: true })
    last = end
  }
  if (last < text.length) segments.push({ text: text.slice(last), bold: false })
  return segments
}
