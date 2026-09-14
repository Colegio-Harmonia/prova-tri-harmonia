import axios from 'axios'

// Aceitamos os delimitadores que aparecem com mais frequência em respostas de
// IA. Internamente todos continuam como segmentos de matemática, para que a
// tela e os documentos não mostrem comandos LaTeX crus ao professor.
export type TextSegment =
  | { type: 'text'; content: string }
  | { type: 'math'; latex: string; display: boolean }

export const IMAGE_ALTERNATIVE_PLACEHOLDER = '[alternativa apresentada como imagem — indisponível no texto]'

function isMathDollarStart(text: string, index: number): boolean {
  const previous = text[index - 1] ?? ''
  // Bloqueia só o "$" de moeda (ex: "R$ 30,00"), sempre precedido de letra.
  // Um número antes do "$" é início legítimo de fórmula (ex: "2$\frac{3}{4}$");
  // descartá-lo desincronizava o parser e engolia o texto seguinte como LaTeX.
  return !/\p{L}/u.test(previous)
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

/** Extrai $...$, $$...$$, \(...\) e \[...\], sem confundir R$ com matemática. */
export function splitLatexSegments(text: string | null | undefined): TextSegment[] {
  const safe = mergeChemicalSubscripts(text ?? '')
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

    const closeAt = safe.indexOf(closer, cursor + opener.length)
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
  return segments
}

export function hasLatexSegments(text: string | null | undefined): boolean {
  return splitLatexSegments(text).some((segment) => segment.type === 'math')
}

/** Fallback para contextos só-texto (gabarito). */
export function stripLatexDelimiters(text: string | null | undefined): string {
  return splitLatexSegments(text).map((segment) => segment.type === 'math' ? segment.latex : segment.content).join('')
}

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
