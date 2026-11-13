/**
 * Assistente de Planejamento — SUGESTÕES de objetivo de aprendizagem para
 * capítulos que o professor deixou sem objetivo.
 *
 * A IA redige as frases a partir do que o capítulo já traz (título, conteúdos
 * e o texto das habilidades BNCC planejadas). O nível de Bloom NÃO vem da IA:
 * é lido do verbo que abre a frase, pela mesma tabela que o sistema usa para
 * classificar objetivos (`bloomVerbs.ts`). Frase que não começa por verbo da
 * tabela, atitudinal ou repetida é descartada. Nada é gravado aqui: o
 * professor escolhe o que quer levar ao rascunho do planejamento.
 */
import { z } from 'zod'
import { BLOOM_VERB_TABLE, isAttitudinal, type BloomLevel } from '@/config/bloomVerbs'
import type { CurriculumSelection } from '@/types/exam'
import { BLOOM_ORDER, type PlanningAnalysis } from './analyzePlanning'

export const MAX_OBJECTIVES_PER_CHAPTER = 4
const CHAPTERS_PER_CALL = 8
const MAX_FIELD_CHARS = 700
const MAX_SKILLS_IN_PROMPT = 10
const MAX_OBJECTIVE_CHARS = 240
/** Mesmo limite pedido à IA no prompt; frase maior é descartada, não cortada. */
export const MAX_OBJECTIVE_WORDS = 25

export type SuggestedObjective = { text: string; bloomLevel: BloomLevel }
export type ChapterObjectiveSuggestions = { rowIndex: number; title: string; objectives: SuggestedObjective[] }

export type ObjectiveRecommendations = {
  status: 'ok' | 'indisponivel'
  message: string | null
  chapters: ChapterObjectiveSuggestions[]
  discardedCount: number
}

export const OBJECTIVES_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'O id do capítulo, exatamente como informado.' },
          objectives: { type: 'array', items: { type: 'string', description: 'Objetivo de aprendizagem começando por um verbo da lista, no infinitivo.' } },
        },
        required: ['id', 'objectives'],
      },
    },
  },
  required: ['chapters'],
}

export const objectivesResultSchema = z.object({
  chapters: z.array(z.object({ id: z.number().int(), objectives: z.array(z.string()) })),
})
export type RawObjectives = z.infer<typeof objectivesResultSchema>

const stripAccents = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '')
const squash = (value: string) => value.replace(/\s+/g, ' ').trim()

const VERBS_BY_LENGTH = (Object.entries(BLOOM_VERB_TABLE) as Array<[BloomLevel, string[]]>)
  .flatMap(([level, verbs]) => verbs.map((verb) => ({ level, verb: stripAccents(verb.toLowerCase()) })))
  .sort((a, b) => b.verb.length - a.verb.length)

/** Nível de Bloom do verbo que ABRE a frase; null se ela não começa por verbo da tabela. */
export function bloomFromLeadingVerb(sentence: string): BloomLevel | null {
  const normalized = stripAccents(squash(sentence).toLowerCase())
  const match = VERBS_BY_LENGTH.find(({ verb }) => normalized === verb || normalized.startsWith(`${verb} `) || normalized.startsWith(`${verb},`))
  return match?.level ?? null
}

/** Capítulos sem nenhum objetivo cognitivo real (vazio, só atitudinal ou só estimado). */
export function chaptersNeedingObjectives(analysis: PlanningAnalysis): PlanningAnalysis['chapters'] {
  return analysis.chapters.filter((chapter) => chapter.bloomEstimated || chapter.bloomLevels.length === 0)
}

function clip(text: string | null | undefined, max = MAX_FIELD_CHARS): string {
  const clean = squash(text ?? '')
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

export function buildObjectivePrompt(
  analysis: PlanningAnalysis,
  selection: CurriculumSelection,
  batch: PlanningAnalysis['chapters'],
  bnccDescriptions: ReadonlyMap<string, string>,
): string {
  const unitsByRow = new Map(selection.units.map((unit) => [unit.rowIndex, unit]))
  const verbs = BLOOM_ORDER.map((level) => `${level}: ${BLOOM_VERB_TABLE[level].join(', ')}`).join('\n')
  const chapters = batch.map((chapter) => {
    const unit = unitsByRow.get(chapter.rowIndex)
    const skills = (unit?.habilidades.skills ?? []).slice(0, MAX_SKILLS_IN_PROMPT).map((skill) => {
      const description = skill.description?.trim() || bnccDescriptions.get(skill.code.trim().toUpperCase())
      return description ? `${skill.code}: ${clip(description, 260)}` : skill.code
    })
    const enem = chapter.enemSkills.map((skill) => `${skill.code}${skill.description ? `: ${clip(skill.description, 200)}` : ''}`)
    return [
      `id: ${chapter.rowIndex}`,
      `título: ${clip(chapter.title)}`,
      `conteúdos: ${clip(chapter.conteudo) || '(não informado)'}`,
      `habilidades BNCC planejadas: ${skills.join(' | ') || '(nenhuma)'}`,
      ...(enem.length ? [`habilidades ENEM planejadas: ${enem.join(' | ')}`] : []),
    ].join('\n')
  }).join('\n\n')

  return `Você apoia professores a redigir objetivos de aprendizagem para o plano de curso.

DISCIPLINA: ${analysis.subject} — ${analysis.gradeYear}º ano (${analysis.segment === 'ensino-medio' ? 'Ensino Médio' : 'Ensino Fundamental'})

VERBOS PERMITIDOS, por nível da Taxonomia de Bloom:
${verbs}

CAPÍTULOS SEM OBJETIVO:
${chapters}

TAREFA: para cada capítulo, escreva de 3 a ${MAX_OBJECTIVES_PER_CHAPTER} objetivos de aprendizagem que o professor possa adotar ou adaptar.

REGRAS OBRIGATÓRIAS:
- Cada objetivo é UMA frase que começa por um verbo da lista acima, no infinitivo, copiado exatamente como está na lista.
- Baseie-se SOMENTE no título, nos conteúdos e nas habilidades informadas do capítulo. Não acrescente conteúdo que o capítulo não traz e não cite códigos de habilidade no texto.
- Objetivos cognitivos e verificáveis numa avaliação (o aluno demonstra que aprendeu). Não escreva objetivos atitudinais (valorizar, respeitar, apreciar, conviver, cuidar).
- Varie os níveis: no máximo um objetivo em "lembrar" e pelo menos um em "analisar", "avaliar" ou "criar" quando o conteúdo permitir.
- Linguagem adequada à série, sem ponto final, sem numeração, até ${MAX_OBJECTIVE_WORDS} palavras por objetivo.
- Devolva um item para CADA capítulo recebido, usando o mesmo "id".`
}

/** Gate determinístico: só passa frase cognitiva, aberta por verbo da tabela, não repetida. */
export function sanitizeObjectives(raw: RawObjectives, chapters: PlanningAnalysis['chapters']): { chapters: ChapterObjectiveSuggestions[]; discardedCount: number } {
  const byRow = new Map(chapters.map((chapter) => [chapter.rowIndex, chapter]))
  const merged = new Map<number, SuggestedObjective[]>()
  let discardedCount = 0

  for (const item of raw.chapters) {
    const chapter = byRow.get(item.id)
    if (!chapter) { discardedCount += item.objectives.length; continue }
    const accepted = merged.get(chapter.rowIndex) ?? []
    for (const rawText of item.objectives) {
      const text = squash(rawText).replace(/^[-•\d.)\s]+/, '').replace(/[.;]+$/, '')
      const bloomLevel = bloomFromLeadingVerb(text)
      const duplicate = accepted.some((existing) => stripAccents(existing.text.toLowerCase()) === stripAccents(text.toLowerCase()))
      if (!text || text.length > MAX_OBJECTIVE_CHARS || text.split(' ').length > MAX_OBJECTIVE_WORDS || !bloomLevel || isAttitudinal(text) || duplicate || accepted.length >= MAX_OBJECTIVES_PER_CHAPTER) { discardedCount++; continue }
      accepted.push({ text: text.charAt(0).toUpperCase() + text.slice(1), bloomLevel })
    }
    merged.set(chapter.rowIndex, accepted)
  }

  return {
    chapters: chapters
      .filter((chapter) => merged.get(chapter.rowIndex)?.length)
      .map((chapter) => ({
        rowIndex: chapter.rowIndex, title: chapter.title,
        objectives: [...merged.get(chapter.rowIndex)!].sort((a, b) => BLOOM_ORDER.indexOf(a.bloomLevel) - BLOOM_ORDER.indexOf(b.bloomLevel)),
      })),
    discardedCount,
  }
}

export type ObjectiveGenerator = (prompt: string) => Promise<unknown>

export async function recommendObjectives(
  analysis: PlanningAnalysis,
  selection: CurriculumSelection,
  bnccDescriptions: ReadonlyMap<string, string>,
  generate: ObjectiveGenerator,
): Promise<ObjectiveRecommendations> {
  const targets = chaptersNeedingObjectives(analysis)
  if (targets.length === 0) return { status: 'ok', message: null, chapters: [], discardedCount: 0 }

  const raw: RawObjectives = { chapters: [] }
  let outOfBatchCount = 0
  for (let start = 0; start < targets.length; start += CHAPTERS_PER_CALL) {
    const batch = targets.slice(start, start + CHAPTERS_PER_CALL)
    const parsed = objectivesResultSchema.parse(await generate(buildObjectivePrompt(analysis, selection, batch, bnccDescriptions)))
    // Só vale resposta sobre capítulo enviado NESTE lote.
    const batchIds = new Set(batch.map((chapter) => chapter.rowIndex))
    for (const item of parsed.chapters) {
      if (batchIds.has(item.id)) raw.chapters.push(item)
      else outOfBatchCount += item.objectives.length
    }
  }
  const { chapters, discardedCount } = sanitizeObjectives(raw, targets)
  return { status: 'ok', message: null, chapters, discardedCount: discardedCount + outOfBatchCount }
}
