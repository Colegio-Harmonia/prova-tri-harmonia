/**
 * Similaridade textual determinística, compartilhada pela checagem de
 * coerência da prova e pelo gate de ambiguidade entre alternativas. Sem IA:
 * é o que permite detectar repetição/duplicação e "duas respostas defensáveis"
 * de forma reproduzível.
 */
const STOP_WORDS = new Set([
  'a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas',
  'um', 'uma', 'para', 'por', 'com', 'que', 'qual', 'como', 'sobre', 'seu', 'sua', 'ao',
  'aos', 'e', 'ou', 'se', 'the', 'of', 'to', 'and', 'is', 'are',
])

export function normalizeOption(value: string): string {
  return value
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s,.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenize(value: string): Set<string> {
  return new Set(
    normalizeOption(value)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  )
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection++
  return intersection / new Set([...a, ...b]).size
}

export function textSimilarity(first: string, second: string): number {
  return jaccard(tokenize(first), tokenize(second))
}

/**
 * Só devolve número quando o texto representa UM único valor ("2,50 m",
 * "R$ 1.210,00", "x = 2,43"). Expressões com vários números ("a=2, b=-3")
 * devolvem null — comparar só o primeiro número gerava falsos positivos.
 */
export function parseSingleNumber(value: string): number | null {
  const matches = value.replace(/\./g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/g)
  if (!matches || matches.length !== 1) return null
  const parsed = Number(matches[0])
  return Number.isFinite(parsed) ? parsed : null
}

/** Números equivalentes em texto pt-BR ("2,50" e "2,5"; "1.200" e "1200"). */
export function sameNumber(first: string, second: string): boolean {
  const a = parseSingleNumber(first)
  const b = parseSingleNumber(second)
  if (a === null || b === null) return false
  return Math.abs(a - b) <= Math.max(1e-6, Math.abs(a) * 1e-6)
}
