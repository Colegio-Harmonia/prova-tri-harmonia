import { isNotNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { curriculumPlanSkills, curriculumPlanUnits } from '@/db/schema'
import { BLOOM_BASE_VERBS, BLOOM_LEVEL_ORDER, BLOOM_VERB_TABLE, inferBloomLevels, type BloomLevel } from '@/config/bloomVerbs'

export type BloomVerbRow = {
  verb: string
  level: BloomLevel
  /** true = verbo da tabela original do manual do projeto. */
  base: boolean
  /** Descrições distintas de habilidades BNCC dos planejamentos que este verbo abre. */
  skills: number
  /** Frases de objetivos dos planejamentos que este verbo abre. */
  objectives: number
}

export type BloomVerbUsage = { rows: BloomVerbRow[]; skillSentences: number; objectiveSentences: number }

const strip = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Separa o campo "Objetivos" em frases, como `parseObjetivos`. */
export function splitObjectiveSentences(raw: string): string[] {
  return raw.split(/\.\s+|\n+/).map((sentence) => sentence.trim()).filter(Boolean)
}

/**
 * Quantas frases cada verbo da tabela ABRE. Com verbos coordenados
 * ("Resolver e elaborar"), a frase conta para o verbo que definiu o nível.
 */
export function countBloomVerbUsage(skillDescriptions: string[], objectiveSentences: string[]): BloomVerbUsage {
  const rows = new Map<string, BloomVerbRow>()
  for (const level of BLOOM_LEVEL_ORDER) {
    for (const verb of BLOOM_VERB_TABLE[level]) rows.set(strip(verb), { verb, level, base: BLOOM_BASE_VERBS.has(verb), skills: 0, objectives: 0 })
  }
  const count = (sentence: string, field: 'skills' | 'objectives') => {
    const inference = inferBloomLevels(sentence)
    if (inference.via !== 'lider' || !inference.level) return
    const decisive = inference.verbs.map((verb) => rows.get(verb)).find((row) => row?.level === inference.level)
    if (decisive) decisive[field]++
  }
  for (const description of skillDescriptions) count(description, 'skills')
  for (const sentence of objectiveSentences) count(sentence, 'objectives')
  return { rows: [...rows.values()], skillSentences: skillDescriptions.length, objectiveSentences: objectiveSentences.length }
}

/** Uso real dos verbos nos planejamentos da escola (todas as versões). Só contagens: nenhum texto de planejamento é devolvido. */
export async function getBloomVerbUsage(): Promise<BloomVerbUsage> {
  const [skills, units] = await Promise.all([
    db.selectDistinct({ description: curriculumPlanSkills.description }).from(curriculumPlanSkills).where(isNotNull(curriculumPlanSkills.description)),
    db.select({ objectives: curriculumPlanUnits.objectives }).from(curriculumPlanUnits).where(isNotNull(curriculumPlanUnits.objectives)),
  ])
  return countBloomVerbUsage(
    skills.map((row) => row.description?.trim() ?? '').filter(Boolean),
    units.flatMap((row) => splitObjectiveSentences(row.objectives ?? '')),
  )
}
