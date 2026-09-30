type SkillWithDescription = { code: string; description: string | null }

const descriptionCache = new Map<string, string | null>()

function normalizeCode(code: string) { return code.trim().toUpperCase() }

export function applyBnccDescriptions<T extends SkillWithDescription>(skills: T[], descriptions: ReadonlyMap<string, string>) {
  return skills.map((skill) => ({
    ...skill,
    description: skill.description?.trim() || descriptions.get(normalizeCode(skill.code)) || null,
  }))
}

async function fetchDescription(code: string): Promise<string | null> {
  if (descriptionCache.has(code)) return descriptionCache.get(code) ?? null
  try {
    const response = await fetch(`https://api.bncc.dev/v1/aprendizagens/${encodeURIComponent(code)}`, {
      signal: AbortSignal.timeout(3500),
      next: { revalidate: 60 * 60 * 24 * 30 },
    })
    if (!response.ok) throw new Error(`BNCC ${response.status}`)
    const body = await response.json() as { texto?: unknown }
    const description = typeof body.texto === 'string' && body.texto.trim() ? body.texto.trim() : null
    descriptionCache.set(code, description)
    return description
  } catch {
    descriptionCache.set(code, null)
    return null
  }
}

export async function resolveBnccDescriptions(codes: string[]) {
  const uniqueCodes = [...new Set(codes.map(normalizeCode).filter(Boolean))]
  const descriptions = new Map<string, string>()
  for (let index = 0; index < uniqueCodes.length; index += 8) {
    const batch = uniqueCodes.slice(index, index + 8)
    const resolved = await Promise.all(batch.map(async (code) => ({ code, description: await fetchDescription(code) })))
    for (const item of resolved) if (item.description) descriptions.set(item.code, item.description)
  }
  return descriptions
}

export async function enrichBnccDescriptions<T extends SkillWithDescription>(skills: T[]) {
  const missingCodes = skills.filter((skill) => !skill.description?.trim()).map((skill) => skill.code)
  if (missingCodes.length === 0) return skills
  return applyBnccDescriptions(skills, await resolveBnccDescriptions(missingCodes))
}
