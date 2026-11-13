/**
 * Assistente de Planejamento — SUGESTÕES de habilidade ENEM por capítulo.
 *
 * A IA só ESCOLHE entre as habilidades oficiais da área que o sistema lhe
 * entrega (lista fechada); nunca redige código nem texto de habilidade. Tudo
 * que ela devolve passa por `sanitizeSuggestions`, que descarta código fora
 * da matriz/recorte, capítulo inexistente e repetição do que já está na
 * planilha — e o texto exibido da habilidade vem sempre da matriz oficial.
 * O resultado é sugestão para o professor validar, nunca alteração da
 * planilha.
 */
import { z } from 'zod'
import type { CurriculumSelection } from '@/types/exam'
import type { EnemCoverageRow, PlanningAnalysis } from './analyzePlanning'

export const MAX_SUGGESTIONS_PER_CHAPTER = 3
const CHAPTERS_PER_CALL = 15
const MAX_FIELD_CHARS = 600

export type SuggestionConfidence = 'alta' | 'media' | 'baixa'

export type EnemSkillSuggestion = {
  code: string
  competency: number
  skill: number
  /** Texto oficial do INEP (nunca o texto devolvido pela IA). */
  description: string
  /** Por que a IA associou a habilidade ao capítulo — para o professor conferir. */
  justification: string
  confidence: SuggestionConfidence
  /** true quando a habilidade ainda não aparece em nenhum capítulo do ano. */
  fillsGap: boolean
}

export type ChapterSuggestions = { rowIndex: number; title: string; suggestions: EnemSkillSuggestion[] }

export type AdvisorRecommendations = {
  status: 'ok' | 'indisponivel' | 'nao_aplicavel'
  message: string | null
  chapters: ChapterSuggestions[]
  /** Lacunas que continuam sem capítulo candidato mesmo após as sugestões. */
  remainingGaps: string[]
  discardedCount: number
}

export const SUGGESTIONS_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: 'O id do capítulo, exatamente como informado.' },
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', description: 'Código da lista de habilidades, ex: "C2:H5".' },
                justification: { type: 'string', description: 'Uma frase citando o elemento do capítulo que sustenta a escolha.' },
                confidence: { type: 'string', enum: ['alta', 'media', 'baixa'] },
              },
              required: ['code', 'justification', 'confidence'],
            },
          },
        },
        required: ['id', 'suggestions'],
      },
    },
  },
  required: ['chapters'],
}

export const suggestionsResultSchema = z.object({
  chapters: z.array(z.object({
    id: z.number().int(),
    suggestions: z.array(z.object({
      code: z.string(),
      justification: z.string(),
      confidence: z.enum(['alta', 'media', 'baixa']).catch('baixa'),
    })),
  })),
})

export type RawSuggestions = z.infer<typeof suggestionsResultSchema>

function clip(text: string | null | undefined): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  return clean.length > MAX_FIELD_CHARS ? `${clean.slice(0, MAX_FIELD_CHARS)}…` : clean
}

/** Capítulos que recebem sugestão: os sem habilidade ENEM primeiro; os demais só para preencher lacunas. */
export function chaptersForSuggestion(analysis: PlanningAnalysis): PlanningAnalysis['chapters'] {
  const without = analysis.chapters.filter((chapter) => chapter.enemSkills.length === 0)
  const withSkills = analysis.chapters.filter((chapter) => chapter.enemSkills.length > 0)
  return analysis.enem && analysis.enem.gapCount > 0 ? [...without, ...withSkills] : without
}

export function buildSuggestionPrompt(
  analysis: PlanningAnalysis,
  selection: CurriculumSelection,
  chapterBatch: PlanningAnalysis['chapters'],
): string {
  if (!analysis.enem) throw new Error('Sugestão de habilidades ENEM só se aplica a disciplinas com área do ENEM.')
  const unitsByRow = new Map(selection.units.map((unit) => [unit.rowIndex, unit]))
  const skills = analysis.enem.rows
    .map((row) => `${row.code} — ${row.description}${row.covered ? '' : ' [SEM COBERTURA NO ANO]'}`)
    .join('\n')
  const chapters = chapterBatch.map((chapter) => {
    const unit = unitsByRow.get(chapter.rowIndex)
    const objectives = (unit?.objetivos ?? []).filter((objective) => objective.kind === 'cognitiva' && !objective.estimated).map((objective) => objective.text).join(' ')
    return [
      `id: ${chapter.rowIndex}`,
      `título: ${clip(chapter.title)}`,
      `conteúdos: ${clip(chapter.conteudo) || '(não informado)'}`,
      `objetivos: ${clip(objectives) || '(não informado)'}`,
      `habilidades ENEM já planejadas: ${chapter.enemSkills.map((skill) => skill.code).join(', ') || '(nenhuma)'}`,
    ].join('\n')
  }).join('\n\n')

  return `Você apoia professores do Ensino Médio a alinhar o plano de curso à Matriz de Referência do ENEM (INEP).

DISCIPLINA: ${analysis.subject} — ${analysis.gradeYear}º ano do Ensino Médio
ÁREA DO ENEM: ${analysis.enem.scope.areaLabel}

HABILIDADES DISPONÍVEIS (lista fechada, texto oficial do INEP):
${skills}

CAPÍTULOS DO PLANEJAMENTO:
${chapters}

TAREFA: para cada capítulo, indique de 0 a ${MAX_SUGGESTIONS_PER_CHAPTER} habilidades da lista que o capítulo realmente permite desenvolver.

REGRAS OBRIGATÓRIAS:
- Use SOMENTE códigos da lista acima, copiados exatamente (ex: "C2:H5"). Nunca crie, adapte ou combine códigos.
- Não repita habilidade que o capítulo já tem planejada.
- Só sugira quando o título, os conteúdos ou os objetivos do capítulo sustentarem a habilidade. Se nada da lista se encaixar, devolva "suggestions": [] para o capítulo — isso é uma resposta correta.
- Entre habilidades igualmente adequadas, prefira as marcadas [SEM COBERTURA NO ANO]. Não force uma habilidade sem cobertura em capítulo que não a sustenta.
- "justification": uma frase curta, em português, citando o elemento concreto do capítulo que sustenta a escolha.
- "confidence": "alta" quando o conteúdo trata diretamente da habilidade; "media" quando a relação depende de como o professor conduz a aula; "baixa" quando é só uma possibilidade.
- Devolva um item para CADA capítulo recebido, usando o mesmo "id".`
}

/**
 * Gate determinístico: nada do que a IA devolve chega ao professor sem
 * existir na matriz oficial do recorte da disciplina.
 */
export function sanitizeSuggestions(raw: RawSuggestions, analysis: PlanningAnalysis): { chapters: ChapterSuggestions[]; discardedCount: number } {
  if (!analysis.enem) return { chapters: [], discardedCount: raw.chapters.reduce((sum, chapter) => sum + chapter.suggestions.length, 0) }
  const official = new Map<string, EnemCoverageRow>(analysis.enem.rows.map((row) => [row.code, row]))
  const chaptersByRow = new Map(analysis.chapters.map((chapter) => [chapter.rowIndex, chapter]))
  const merged = new Map<number, EnemSkillSuggestion[]>()
  let discardedCount = 0

  for (const item of raw.chapters) {
    const chapter = chaptersByRow.get(item.id)
    if (!chapter) { discardedCount += item.suggestions.length; continue }
    const accepted = merged.get(chapter.rowIndex) ?? []
    for (const suggestion of item.suggestions) {
      const code = normalizeEnemCode(suggestion.code)
      const row = code ? official.get(code) : undefined
      const justification = suggestion.justification.replace(/\s+/g, ' ').trim()
      const duplicate = accepted.some((existing) => existing.code === code) || chapter.enemSkills.some((planned) => planned.code === code)
      if (!row || !justification || duplicate || accepted.length >= MAX_SUGGESTIONS_PER_CHAPTER) { discardedCount++; continue }
      accepted.push({
        code: row.code, competency: row.competency, skill: row.skill, description: row.description,
        justification, confidence: suggestion.confidence, fillsGap: !row.covered,
      })
    }
    merged.set(chapter.rowIndex, accepted)
  }

  const chapters = analysis.chapters
    .filter((chapter) => merged.get(chapter.rowIndex)?.length)
    .map((chapter) => ({ rowIndex: chapter.rowIndex, title: chapter.title, suggestions: merged.get(chapter.rowIndex)! }))
  return { chapters, discardedCount }
}

/** Aceita só o par exato "C<n>:H<n>" (com separador tolerante); qualquer outra coisa é descartada. */
export function normalizeEnemCode(value: string): string | null {
  const match = /^\s*C\s*(\d{1,2})\s*[:\-–/ ]\s*H\s*(\d{1,2})\s*$/i.exec(value)
  return match ? `C${Number(match[1])}:H${Number(match[2])}` : null
}

export function remainingGapCodes(analysis: PlanningAnalysis, chapters: ChapterSuggestions[]): string[] {
  if (!analysis.enem) return []
  const suggested = new Set(chapters.flatMap((chapter) => chapter.suggestions.map((suggestion) => suggestion.code)))
  return analysis.enem.rows.filter((row) => !row.covered && !suggested.has(row.code)).map((row) => row.code)
}

export type SuggestionGenerator = (prompt: string) => Promise<unknown>

/**
 * Orquestra as chamadas (em lotes de capítulos) com um gerador injetável —
 * a rota usa o LLM configurado do sistema; os testes usam um dublê.
 */
export async function recommendEnemSkills(
  analysis: PlanningAnalysis,
  selection: CurriculumSelection,
  generate: SuggestionGenerator,
): Promise<AdvisorRecommendations> {
  if (!analysis.enem) {
    return { status: 'nao_aplicavel', message: 'Sugestão de habilidades do ENEM só se aplica a disciplinas do Ensino Médio com área do ENEM.', chapters: [], remainingGaps: [], discardedCount: 0 }
  }
  if (analysis.chapters.length === 0) {
    return { status: 'ok', message: 'O planejamento não tem capítulos; não há onde sugerir habilidades.', chapters: [], remainingGaps: remainingGapCodes(analysis, []), discardedCount: 0 }
  }
  const targets = chaptersForSuggestion(analysis)
  if (targets.length === 0) {
    return { status: 'ok', message: 'Todos os capítulos já têm habilidade do ENEM e não há lacunas de cobertura no recorte da disciplina.', chapters: [], remainingGaps: [], discardedCount: 0 }
  }

  const raw: RawSuggestions = { chapters: [] }
  for (let start = 0; start < targets.length; start += CHAPTERS_PER_CALL) {
    const batch = targets.slice(start, start + CHAPTERS_PER_CALL)
    const parsed = suggestionsResultSchema.parse(await generate(buildSuggestionPrompt(analysis, selection, batch)))
    raw.chapters.push(...parsed.chapters)
  }

  const { chapters, discardedCount } = sanitizeSuggestions(raw, analysis)
  return { status: 'ok', message: null, chapters, remainingGaps: remainingGapCodes(analysis, chapters), discardedCount }
}
