/** Corrige somente apresentação. Nunca completa conteúdo ou fecha JSON truncado. */
export function parseResponseJson(text: string): { value: unknown; repaired: boolean } {
  try { return { value: JSON.parse(text), repaired: false } } catch { /* normalização conservadora abaixo */ }
  const trimmed = text.trim().replace(/^\uFEFF/, '')
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed)
  const source = fenced ? fenced[1].trim() : trimmed
  let output = ''
  let inString = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]
    if (inString && char === '\\') {
      const next = source[index + 1]
      const valid = next !== undefined && (/["\\/bfnrt]/.test(next) || (next === 'u' && /^[0-9a-f]{4}$/i.test(source.slice(index + 2, index + 6))))
      output += valid ? char + next : '\\\\'
      if (valid) index++
      continue
    }
    if (char === '"') inString = !inString
    if (inString && char.charCodeAt(0) < 32) {
      output += JSON.stringify(char).slice(1, -1)
    } else if (!inString && char === ',' && /^\s*[}\]]/.test(source.slice(index + 1))) {
      continue
    } else output += char
  }
  return { value: JSON.parse(output), repaired: true }
}

/** Aceita só a representação decimal inequívoca de um número finito. */
export function normalizeBlueprintNumber(value: unknown): unknown {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value.trim())) return value
  const number = Number(value.trim())
  return Number.isFinite(number) ? number : value
}
