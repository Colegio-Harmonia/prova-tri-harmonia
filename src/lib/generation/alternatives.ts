import { jaccard, normalizeOption, sameNumber, tokenize } from './similarity'

export type AlternativeLike = { letter: string; text: string }

export type AlternativeAmbiguity = {
  first: string
  second: string
  severity: 'bloqueante' | 'alerta'
  reason: string
}

// Acima deste Jaccard, duas alternativas textualmente longas são
// praticamente a mesma resposta ("duas respostas defensáveis").
const DEFENSIBLE_JACCARD = 0.8
const NEGATIONS = ['nao', 'nunca', 'jamais', 'nenhum', 'nenhuma', 'sem']

/**
 * "Esqueleto" matemático: a alternativa sem as palavras (3+ letras), só dígitos,
 * sinais, operadores e variáveis. Duas alternativas com o mesmo vocabulário mas
 * esqueleto diferente ("y = -x + 2…coef. -1" vs "y = x + 2…coef. 1") são respostas
 * distintas, não "a mesma resposta escrita de outro jeito".
 */
function mathSkeleton(text: string): string {
  return text.toLowerCase().replace(/[a-zà-ú]{3,}/g, '').replace(/\s+/g, '')
}

function differInMath(first: string, second: string): boolean {
  const a = mathSkeleton(first)
  const b = mathSkeleton(second)
  return /\d/.test(a) && /\d/.test(b) && a !== b
}

function hasNegation(text: string): boolean {
  return tokenize(text).has('nao') || NEGATIONS.some((word) => normalizeOption(text).includes(` ${word} `))
}

/**
 * Gate de ambiguidade por par de alternativas, determinístico. Cobre:
 * - duplicação literal (normalizada);
 * - equivalência numérica ("2,50" ≡ "2,5");
 * - pares textualmente quase idênticos (mesma resposta escrita de outro jeito);
 * - pares que só se distinguem por negação (risco clássico de dupla leitura).
 */
export function detectAlternativeAmbiguities(alternatives: AlternativeLike[]): AlternativeAmbiguity[] {
  const issues: AlternativeAmbiguity[] = []
  for (let first = 0; first < alternatives.length; first++) {
    for (let second = first + 1; second < alternatives.length; second++) {
      const a = alternatives[first]
      const b = alternatives[second]
      const normalizedA = normalizeOption(a.text)
      const normalizedB = normalizeOption(b.text)

      if (normalizedA && normalizedA === normalizedB) {
        issues.push({ first: a.letter, second: b.letter, severity: 'bloqueante', reason: `Alternativas ${a.letter} e ${b.letter} têm o mesmo conteúdo.` })
        continue
      }
      if (sameNumber(a.text, b.text)) {
        issues.push({ first: a.letter, second: b.letter, severity: 'bloqueante', reason: `Alternativas ${a.letter} e ${b.letter} representam o mesmo valor numérico.` })
        continue
      }

      const similarity = jaccard(tokenize(a.text), tokenize(b.text))
      const longEnough = tokenize(a.text).size >= 4 && tokenize(b.text).size >= 4
      if (longEnough && similarity >= DEFENSIBLE_JACCARD && !differInMath(a.text, b.text)) {
        issues.push({ first: a.letter, second: b.letter, severity: 'bloqueante', reason: `Alternativas ${a.letter} e ${b.letter} são praticamente equivalentes (${Math.round(similarity * 100)}% de termos em comum); há mais de uma resposta defensável.` })
        continue
      }
      // Alta sobreposição + negação de um lado = leitura ambígua.
      if (longEnough && similarity >= 0.6 && hasNegation(a.text) !== hasNegation(b.text)) {
        issues.push({ first: a.letter, second: b.letter, severity: 'alerta', reason: `Alternativas ${a.letter} e ${b.letter} diferem essencialmente por negação; confirme que só uma é defensável.` })
      }
    }
  }
  return issues
}
