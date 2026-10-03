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

/** Um número com seus separadores: "1.210,00", "2,5", "0.5", "-3". */
export const NUMBER_TOKEN = /-?\d+(?:[.,]\d+)*/g

/**
 * Lê UM número escrito em pt-BR ou com ponto decimal. O ponto é separador de
 * milhar só quando forma grupos de 3 dígitos ("1.200", "1.210,00"); caso
 * contrário é decimal ("0.5", "2.5", "3.14159"). Antes todo ponto era apagado e
 * "0.5" virava 5, o que colidia com a resposta "5" (falso "mesmo valor") e
 * escondia "2,5" ≡ "2.5". Token ambíguo ("1,2,3") devolve null.
 */
export function parseNumberToken(token: string): number | null {
  const sign = token.startsWith('-') ? -1 : 1
  const digits = token.replace(/^-/, '')
  let normalized: string
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(digits) && !digits.startsWith('0.')) normalized = digits.replace(/\./g, '').replace(',', '.')
  else if (/^\d+,\d+$/.test(digits)) normalized = digits.replace(',', '.')
  else if (/^\d+\.\d+$/.test(digits)) normalized = digits
  else if (/^\d+$/.test(digits)) normalized = digits
  else return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? sign * parsed : null
}

/**
 * Só devolve número quando o texto representa UM único valor ("2,50 m",
 * "R$ 1.210,00", "x = 2,43", "0.5"). Expressões com vários números ("a=2, b=-3")
 * devolvem null — comparar só o primeiro número gerava falsos positivos.
 */
export function parseSingleNumber(value: string): number | null {
  const tokens = value.match(NUMBER_TOKEN)
  if (!tokens || tokens.length !== 1) return null
  return parseNumberToken(tokens[0])
}

/** Números equivalentes em texto pt-BR ("2,50" e "2,5"; "1.200" e "1200"). */
export function sameNumber(first: string, second: string): boolean {
  const a = parseSingleNumber(first)
  const b = parseSingleNumber(second)
  if (a === null || b === null) return false
  return Math.abs(a - b) <= Math.max(1e-6, Math.abs(a) * 1e-6)
}
