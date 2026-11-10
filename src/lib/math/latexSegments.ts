// Aceitamos os delimitadores que aparecem com mais frequência em respostas de
// IA. Internamente todos continuam como segmentos de matemática, para que a
// tela e os documentos não mostrem comandos LaTeX crus ao professor.
export type TextSegment =
  | { type: 'text'; content: string }
  | { type: 'math'; latex: string; display: boolean }

export const IMAGE_ALTERNATIVE_PLACEHOLDER = '[alternativa apresentada como imagem — indisponível no texto]'

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0
  while (index > 0 && text[--index] === '\\') backslashes++
  return backslashes % 2 === 1
}

function isMathDollarStart(text: string, index: number): boolean {
  if (isEscaped(text, index)) return false
  // Currency is literal, while adjacent notation such as cos$^{8}$ is math.
  return !(/\b(?:R|US|CA|AU|NZ|HK)$/.test(text.slice(0, index)) && /^\s*-?\d/.test(text.slice(index + 1)))
}

function findMathCloser(text: string, closer: string, start: number): number {
  let index = text.indexOf(closer, start)
  while (index !== -1 && isEscaped(text, index)) index = text.indexOf(closer, index + closer.length)
  return index
}

// Conteúdo que não é fórmula: reticências usadas para marcar trecho omitido
// (ex.: "\[…\]" extraído de textos da ENEM) ou só pontuação/espaço. Enviar isso
// ao renderizador externo devolve a imagem de erro "Blank Equation".
const NON_MATH_CONTENT = /^[.\u2026\s\-–—]*$/u

export function isRenderableMath(latex: string): boolean {
  const value = latex.trim()
  return value.length > 0 && !NON_MATH_CONTENT.test(value)
}

// Fórmula molecular que o gerador fatiou cercando só o subscrito com $:
// "C$_4$H$_8$O" vira "$C_4H_8O$". Só dispara quando há subscrito/sobscrito
// delimitado por $ colado a letras de elemento, então nunca mexe em palavras
// (não confunde "ENEM"/"SOLO" nem o "$" de moeda).
const CHEM_SUBSCRIPT_FORMULA = /([A-Z][a-z]?(?:[A-Z][a-z]?|\$[_^][^$]*\$)*\$[_^][^$]*\$(?:[A-Z][a-z]?|\$[_^][^$]*\$)*)/g

function mergeChemicalSubscripts(text: string): string {
  return text.replace(CHEM_SUBSCRIPT_FORMULA, (match) => `$${match.replace(/\$/g, '')}$`)
}

// Também reconhece a notação sem delimitadores recebida do acervo e de
// questões antigas. Só promove trechos que contêm comandos ou expoentes.
const GROUP = String.raw`\{(?:[^{}]|\{[^{}]*\})*\}`
const SCRIPT = String.raw`[_^](?:${GROUP}|[A-Za-z0-9+-])`
const ATOM = String.raw`(?:\\[A-Za-z]+(?:${GROUP})*|\d+(?:${GROUP}\d+|[.,]\d+)?|(?<![A-Za-z])(?:[A-Za-z](?=[_^])|(?![eaou]\b)[A-Za-z](?![A-Za-z])))(?:${SCRIPT})*`
const BARE_EXPRESSION = new RegExp(String.raw`${ATOM}(?:(?:\s*[=+*/-]\s*|\s*)${ATOM})*`, 'g')

function splitBareMath(content: string): TextSegment[] {
  const parts: TextSegment[] = []
  let end = 0
  for (const match of content.matchAll(BARE_EXPRESSION)) {
    if (!/\\[A-Za-z]+|[_^]/.test(match[0])) continue
    if (match.index! > end) parts.push({ type: 'text', content: content.slice(end, match.index) })
    parts.push({ type: 'math', latex: match[0], display: false })
    end = match.index! + match[0].length
  }
  if (end < content.length) parts.push({ type: 'text', content: content.slice(end) })
  return parts
}

/** Extrai $...$, $$...$$, \(...\) e \[...\], sem confundir R$ com matemática. */
export function splitLatexSegments(text: string | null | undefined): TextSegment[] {
  // Fontes químicas podem anexar o estado físico como um segundo subscrito
  // (CO_{3}_{(aq)}). Um átomo vazio mantém o estado na mesma posição sem
  // atribuir dois subscritos ao mesmo símbolo, o que é inválido em LaTeX.
  const safe = mergeChemicalSubscripts((text ?? '').replace(/\thickspace\b|\\thickspace\b/g, '\\;').replace(/\times\b/g, '\\times').replace(/\text(?=\{)/g, '\\text'))
    .replace(/(?<=\})(?<!\{\})_\{(\((?:aq|s|l|g)\))\}/g, '{}_{$1}')
  const segments: TextSegment[] = []
  let cursor = 0
  let textStart = 0

  const pushText = (end: number) => {
    if (end > textStart) segments.push({ type: 'text', content: safe.slice(textStart, end) })
  }

  while (cursor < safe.length) {
    let opener = ''
    let closer = ''
    let display = false
    if (safe.startsWith('$$', cursor) && isMathDollarStart(safe, cursor)) {
      opener = '$$'; closer = '$$'; display = true
    } else if (safe[cursor] === '$' && isMathDollarStart(safe, cursor)) {
      opener = '$'; closer = '$'
    } else if (safe.startsWith('\\(', cursor)) {
      opener = '\\('; closer = '\\)'
    } else if (safe.startsWith('\\[', cursor)) {
      opener = '\\['; closer = '\\]'; display = true
    } else {
      cursor += 1
      continue
    }

    const closeAt = findMathCloser(safe, closer, cursor + opener.length)
    if (closeAt === -1) {
      cursor += opener.length
      continue
    }
    const latex = safe.slice(cursor + opener.length, closeAt).trim()
    if (!isRenderableMath(latex)) {
      // Não é fórmula: devolve como texto, sem mandar para o renderizador.
      // Para \[…\]/\(…\), restaura os delimitadores literais; para $/$$,
      // remove os cifrões mantendo o conteúdo (ex.: reticências de omissão).
      pushText(cursor)
      if (opener === '\\[' || opener === '\\(') {
        segments.push({ type: 'text', content: `${opener === '\\[' ? '[' : '('}${latex}${opener === '\\[' ? ']' : ')'}` })
      } else {
        segments.push({ type: 'text', content: latex })
      }
      cursor = closeAt + closer.length
      textStart = cursor
      continue
    }
    pushText(cursor)
    segments.push({ type: 'math', latex, display })
    cursor = closeAt + closer.length
    textStart = cursor
  }
  pushText(safe.length)
  return segments.flatMap((segment) => segment.type === 'text' ? splitBareMath(segment.content) : [segment])
}

export function hasLatexSegments(text: string | null | undefined): boolean {
  return splitLatexSegments(text).some((segment) => segment.type === 'math')
}

/** Fallback para contextos só-texto (gabarito). */
export function stripLatexDelimiters(text: string | null | undefined): string {
  return splitLatexSegments(text).map((segment) => segment.type === 'math' ? segment.latex : segment.content).join('')
}
