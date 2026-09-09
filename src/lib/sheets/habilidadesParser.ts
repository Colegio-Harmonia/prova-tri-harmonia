import type { Segment, HabilidadesParseResult } from '@/types/exam'

// EF12EF01, EF08GE03, EM13LP01, EM13CNT201, etc. — segment picked by the caller from
// the known selection, never guessed from the cell content.
const CODE_PATTERN_FUNDAMENTAL = /EF\d{2,3}[A-Z]{2,4}\d{2,3}/g
// A BNCC do Ensino Médio combina áreas com 2 a 4 letras e códigos com 2 ou
// 3 algarismos: por exemplo, EM13LP01 e EM13LGG401.
const CODE_PATTERN_MEDIO = /EM13[A-Z]{2,4}\d{2,3}/g

function getCodePattern(segment: Segment): RegExp {
  return segment === 'ensino-medio' ? CODE_PATTERN_MEDIO : CODE_PATTERN_FUNDAMENTAL
}

function hasParentheses(raw: string, codePattern: RegExp): boolean {
  const withParens = new RegExp(`\\(${codePattern.source}\\)`)
  return withParens.test(raw)
}

/**
 * Implements the 3 documented "Habilidades" cell formats from the root
 * CLAUDE.md — never fabricates a code or a description.
 */
export function parseHabilidades(raw: string | null | undefined, segment: Segment): HabilidadesParseResult {
  const trimmed = (raw ?? '').trim()

  if (!trimmed) {
    return { status: 'nao_mapeado', skills: [], reason: 'célula vazia' }
  }

  const codePattern = getCodePattern(segment)

  // Format 1: "(EF12EF01) Descrição...(EF12EF02) Descrição..."
  if (hasParentheses(trimmed, codePattern)) {
    const withParens = new RegExp(`\\((${codePattern.source})\\)([\\s\\S]*?)(?=\\(${codePattern.source}\\)|$)`, 'g')
    const skills: { code: string; description: string | null }[] = []
    let match: RegExpExecArray | null
    while ((match = withParens.exec(trimmed)) !== null) {
      const description = match[2]?.trim()
      skills.push({ code: match[1], description: description ? description : null })
    }
    if (skills.length) return { status: 'mapeado', skills }
  }

  // Format 2: bare codes, no description — "EF08GE01 EF08GE03 EF08GE04"
  const bareCodes = trimmed.match(codePattern)
  if (bareCodes && bareCodes.length) {
    const skills = bareCodes.map((code) => ({ code, description: null }))
    return { status: 'mapeado', skills }
  }

  // Format 3: placeholder for external, unmapped content (e.g. "SAE +") or
  // any other non-code text — treated the same as an empty cell.
  return { status: 'nao_mapeado', skills: [], reason: `sem código BNCC reconhecível: "${trimmed}"` }
}
