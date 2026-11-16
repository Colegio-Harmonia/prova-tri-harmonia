// Sugestão de pré-requisitos curriculares por IA ("A é base para B").
//
// A IA não inventa código: para cada habilidade-alvo ela só pode escolher entre
// as habilidades da MESMA disciplina planejadas ANTES (séries anteriores, ou a
// mesma série em bimestre anterior). Qualquer código fora dessa lista, repetido
// ou sem justificativa é descartado aqui. Nada é aprovado automaticamente: o
// resultado vira sugestão para a coordenação revisar.

import { z } from 'zod'

export const PREREQUISITE_RULES = {
  /** Pré-requisitos aceitos por habilidade-alvo. */
  maxPerSkill: 3,
  /** Habilidades-alvo por chamada de IA. */
  targetsPerCall: 6,
  /** Teto de candidatos no prompt; acima disso cai a série mais antiga. */
  maxCandidates: 90,
  /** Quantas séries para trás entram como candidatas. */
  levelsBack: 2,
  minRationaleChars: 20,
  maxRationaleChars: 400,
} as const

export const STRENGTH_WEIGHT = { essencial: 0.9, importante: 0.7, apoio: 0.5 } as const
export type PrerequisiteStrength = keyof typeof STRENGTH_WEIGHT
const STRENGTHS = Object.keys(STRENGTH_WEIGHT) as PrerequisiteStrength[]

export type CatalogSkill = {
  code: string
  description: string | null
  segment: string
  gradeYear: number
  subject: string
  /** Primeiro bimestre em que a habilidade aparece no planejamento da série. */
  bimester: number
}

export type SuggestionGroup = { bimester: number; targets: CatalogSkill[]; candidates: CatalogSkill[] }

export type PrerequisiteSuggestion = {
  prerequisite: CatalogSkill
  skill: CatalogSkill
  strength: PrerequisiteStrength
  rationale: string
}

/** Posição da série na escolaridade: 1º-9º do Fundamental, 10-12 no Ensino Médio. */
export function levelOf(segment: string, gradeYear: number) {
  return segment === 'ensino-medio' ? 9 + gradeYear : gradeYear
}

export function gradeLabel(segment: string, gradeYear: number) {
  return segment === 'ensino-medio' ? `${gradeYear}ª série EM` : `${gradeYear}º ano`
}

const normalizeCode = (code: string) => code.trim().toUpperCase()
const squash = (value: string) => value.replace(/\s+/g, ' ').trim()
const clip = (text: string | null, max: number) => { const clean = squash(text ?? ''); return clean.length > max ? `${clean.slice(0, max)}…` : clean }

/**
 * Grupos de habilidades-alvo da série, um por bimestre, cada um com a lista
 * de candidatos permitidos. Habilidade repetida em vários bimestres conta no
 * primeiro em que aparece.
 */
export function buildSuggestionGroups(catalog: CatalogSkill[], target: { segment: string; gradeYear: number }): SuggestionGroup[] {
  const level = levelOf(target.segment, target.gradeYear)
  const first = new Map<string, CatalogSkill>()
  for (const skill of [...catalog].sort((a, b) => levelOf(a.segment, a.gradeYear) - levelOf(b.segment, b.gradeYear) || a.bimester - b.bimester)) {
    const key = `${levelOf(skill.segment, skill.gradeYear)}:${normalizeCode(skill.code)}`
    if (!first.has(key)) first.set(key, { ...skill, code: normalizeCode(skill.code) })
  }
  const skills = [...first.values()]
  const targets = skills.filter((skill) => levelOf(skill.segment, skill.gradeYear) === level)
  const bimesters = [...new Set(targets.map((skill) => skill.bimester))].sort((a, b) => a - b)

  return bimesters.map((bimester) => {
    const groupTargets = targets.filter((skill) => skill.bimester === bimester)
    const targetCodes = new Set(groupTargets.map((skill) => skill.code))
    const earlier = skills.filter((skill) => {
      const skillLevel = levelOf(skill.segment, skill.gradeYear)
      if (targetCodes.has(skill.code)) return false
      if (skillLevel === level) return skill.bimester < bimester
      return skillLevel < level && skillLevel >= level - PREREQUISITE_RULES.levelsBack
    })
    // Um código só uma vez, na ocorrência mais recente; acima do teto cai a série mais antiga.
    const unique = new Map<string, CatalogSkill>()
    for (const skill of earlier.sort((a, b) => levelOf(b.segment, b.gradeYear) - levelOf(a.segment, a.gradeYear) || b.bimester - a.bimester)) if (!unique.has(skill.code)) unique.set(skill.code, skill)
    const candidates = [...unique.values()].slice(0, PREREQUISITE_RULES.maxCandidates)
      .sort((a, b) => levelOf(a.segment, a.gradeYear) - levelOf(b.segment, b.gradeYear) || a.bimester - b.bimester || a.code.localeCompare(b.code))
    return { bimester, targets: groupTargets, candidates }
  }).filter((group) => group.candidates.length > 0)
}

export const PREREQUISITES_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    habilidades: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          codigo: { type: 'string', description: 'Código da habilidade-alvo, exatamente como informado.' },
          prerequisitos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                codigo: { type: 'string', description: 'Código de um candidato da lista, exatamente como informado.' },
                forca: { type: 'string', enum: STRENGTHS },
                justificativa: { type: 'string', description: 'Por que esta habilidade é base para a alvo, em uma ou duas frases.' },
              },
              required: ['codigo', 'forca', 'justificativa'],
            },
          },
        },
        required: ['codigo', 'prerequisitos'],
      },
    },
  },
  required: ['habilidades'],
}

export const prerequisitesResultSchema = z.object({
  habilidades: z.array(z.object({
    codigo: z.string(),
    prerequisitos: z.array(z.object({ codigo: z.string(), forca: z.string(), justificativa: z.string() })),
  })),
})
export type RawPrerequisites = z.infer<typeof prerequisitesResultSchema>

export function buildPrerequisitePrompt(subject: string, targets: CatalogSkill[], candidates: CatalogSkill[]): string {
  const line = (skill: CatalogSkill) => `${skill.code} (${gradeLabel(skill.segment, skill.gradeYear)}, ${skill.bimester}º bim.): ${clip(skill.description, 220) || '(descrição não informada)'}`
  return `Você apoia a coordenação pedagógica a mapear PRÉ-REQUISITOS entre habilidades da BNCC.

DISCIPLINA: ${subject}

HABILIDADES-ALVO:
${targets.map(line).join('\n')}

CANDIDATOS (habilidades planejadas ANTES das alvos):
${candidates.map(line).join('\n')}

TAREFA: para cada habilidade-alvo, indique quais candidatos são pré-requisito dela, isto é, aprendizagens que o aluno precisa ter consolidado para conseguir desenvolver a alvo.

REGRAS OBRIGATÓRIAS:
- Use SOMENTE códigos da lista de CANDIDATOS, copiados exatamente. Nunca invente código nem use uma habilidade-alvo como pré-requisito.
- No máximo ${PREREQUISITE_RULES.maxPerSkill} pré-requisitos por alvo, só os mais diretos. Pode ser nenhum: devolva lista vazia quando nenhum candidato for base de fato.
- Pré-requisito é dependência de aprendizagem, não apenas tema parecido ou mesma unidade.
- "forca": "essencial" (sem ela a alvo não se desenvolve), "importante" (dificulta bastante) ou "apoio" (ajuda, mas não impede).
- "justificativa": uma ou duas frases objetivas dizendo o que da habilidade-base a alvo usa.
- Devolva um item para CADA habilidade-alvo recebida, usando o mesmo "codigo".`
}

/** Gate determinístico: só passa código da lista, força válida, justificativa útil, sem repetição. */
export function sanitizePrerequisites(raw: RawPrerequisites, group: Pick<SuggestionGroup, 'targets' | 'candidates'>): { suggestions: PrerequisiteSuggestion[]; discardedCount: number } {
  const targets = new Map(group.targets.map((skill) => [skill.code, skill]))
  const candidates = new Map(group.candidates.map((skill) => [skill.code, skill]))
  const accepted = new Map<string, PrerequisiteSuggestion[]>()
  let discardedCount = 0
  for (const item of raw.habilidades) {
    const skill = targets.get(normalizeCode(item.codigo))
    if (!skill) { discardedCount += item.prerequisitos.length; continue }
    const list = accepted.get(skill.code) ?? []
    for (const entry of item.prerequisitos) {
      const prerequisite = candidates.get(normalizeCode(entry.codigo))
      const strength = entry.forca.trim().toLowerCase() as PrerequisiteStrength
      const rationale = squash(entry.justificativa)
      const duplicate = prerequisite && list.some((existing) => existing.prerequisite.code === prerequisite.code)
      if (!prerequisite || duplicate || !STRENGTHS.includes(strength) || rationale.length < PREREQUISITE_RULES.minRationaleChars || rationale.length > PREREQUISITE_RULES.maxRationaleChars || list.length >= PREREQUISITE_RULES.maxPerSkill) { discardedCount++; continue }
      list.push({ prerequisite, skill, strength, rationale })
    }
    accepted.set(skill.code, list)
  }
  return { suggestions: [...accepted.values()].flat(), discardedCount }
}

export type PrerequisiteGenerator = (prompt: string) => Promise<unknown>

/** Roda a IA em lotes e devolve só o que passou no gate. */
export async function suggestPrerequisitesForGroups(subject: string, groups: SuggestionGroup[], generate: PrerequisiteGenerator): Promise<{ suggestions: PrerequisiteSuggestion[]; discardedCount: number; callCount: number }> {
  const suggestions: PrerequisiteSuggestion[] = []
  let discardedCount = 0
  let callCount = 0
  for (const group of groups) {
    for (let start = 0; start < group.targets.length; start += PREREQUISITE_RULES.targetsPerCall) {
      const batch = group.targets.slice(start, start + PREREQUISITE_RULES.targetsPerCall)
      callCount++
      const parsed = prerequisitesResultSchema.parse(await generate(buildPrerequisitePrompt(subject, batch, group.candidates)))
      const result = sanitizePrerequisites(parsed, { targets: batch, candidates: group.candidates })
      suggestions.push(...result.suggestions)
      discardedCount += result.discardedCount
    }
  }
  return { suggestions, discardedCount, callCount }
}
