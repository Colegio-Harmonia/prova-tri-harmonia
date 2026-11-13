import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { llmAvailable } from '@/lib/gemini/llmClient'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import { TabResolutionError } from '@/lib/sheets/tabResolver'
import type { CurriculumSelection, Segment } from '@/types/exam'
import { SheetNotConfiguredError } from '@/config/gradeSheets'
import { combineSources, getBimesterPlanSelections, type AdvisorViewer } from './internalPlanSource'
import { resolveBnccDescriptions } from '@/lib/curriculum/bnccDescriptions'
import { analyzePlanning, type PlanningAnalysis } from './analyzePlanning'
import { chaptersNeedingObjectives, OBJECTIVES_RESPONSE_SCHEMA, objectivesResultSchema, recommendObjectives, type ObjectiveRecommendations } from './objectiveSuggestions'
import {
  recommendEnemSkills,
  SUGGESTIONS_RESPONSE_SCHEMA,
  suggestionsResultSchema,
  type AdvisorRecommendations,
} from './recommendations'

export type PlanningAdvisorReport = {
  analysis: PlanningAnalysis
  recommendations: AdvisorRecommendations | null
  /** Objetivos sugeridos para capítulos sem objetivo (qualquer segmento). */
  objectives: ObjectiveRecommendations | null
}

export type PlanningAdvisorParams = {
  segment: Segment
  gradeYear: number
  subject: string
  /** Quem está pedindo: define se rascunhos do Planejamento podem ser lidos. */
  viewer: AdvisorViewer
  /** Ano letivo dos planejamentos internos a considerar; padrão: ano corrente. */
  academicYear?: number
  /** Pede sugestões à IA: habilidades ENEM (Ensino Médio) e objetivos para capítulos sem objetivo. */
  withSuggestions: boolean
}

/**
 * Planejamento da Prova TRI primeiro: cada bimestre que já tem planejamento
 * interno é lido de lá; a planilha só completa os bimestres restantes. Se a
 * planilha não puder ser lida (aba ambígua, série sem planilha), o que houver
 * no Planejamento basta; sem nenhum dos dois, devolve o erro da planilha.
 */
async function loadYearCurriculum(params: PlanningAdvisorParams): Promise<CurriculumSelection> {
  const scope = { segment: params.segment, gradeYear: params.gradeYear, subject: params.subject }
  const sheetYear = new Date().getFullYear()
  const academicYear = params.academicYear ?? sheetYear
  const parts = await getBimesterPlanSelections(scope, academicYear, params.viewer)

  // Os quatro bimestres já estão no Planejamento: a planilha não é mais consultada.
  if (new Set(parts.map((part) => part.bimester)).size === 4) return combineSources(scope, parts, null)

  // A planilha é uma só por série e representa o ano letivo corrente: não
  // pode completar o plano de outro ano.
  if (academicYear !== sheetYear) {
    return combineSources(scope, parts, null, [`Só o Planejamento da Prova TRI foi considerado: a planilha representa ${sheetYear}, não ${academicYear}.`])
  }

  try {
    return combineSources(scope, parts, await getCurriculumForExam(scope))
  } catch (error) {
    const sheetUnavailable = error instanceof TabResolutionError || error instanceof SheetNotConfiguredError
    if (!sheetUnavailable || !parts.length) throw error
    return combineSources(scope, parts, null, ['Os bimestres sem planejamento na Prova TRI ficaram fora da análise: a planilha desta disciplina não pôde ser lida.'])
  }
}

/**
 * Lê o planejamento do ANO INTEIRO (sem filtro de bimestre nem de Status
 * Cronograma), analisa e, se pedido, acrescenta sugestões da IA. Só leitura:
 * a análise em si não grava nada.
 */
export async function runPlanningAdvisor(params: PlanningAdvisorParams): Promise<PlanningAdvisorReport> {
  const selection = await loadYearCurriculum(params)
  const analysis = analyzePlanning(selection)
  if (!params.withSuggestions) return { analysis, recommendations: null, objectives: null }

  const needsObjectives = chaptersNeedingObjectives(analysis).length > 0
  if (!analysis.enem && !needsObjectives) return { analysis, recommendations: null, objectives: null }

  if (!(await llmAvailable())) {
    const message = 'A IA não está configurada neste ambiente; a análise acima não depende dela.'
    return {
      analysis,
      recommendations: analysis.enem ? { status: 'indisponivel', message, chapters: [], remainingGaps: [], discardedCount: 0 } : null,
      objectives: needsObjectives ? { status: 'indisponivel', message, chapters: [], discardedCount: 0 } : null,
    }
  }

  // As duas frentes são independentes: uma falhar não derruba a outra.
  const [recommendations, objectives] = await Promise.all([
    analysis.enem ? suggestEnemSkills(analysis, selection) : null,
    needsObjectives ? suggestObjectives(analysis, selection) : null,
  ])
  return { analysis, recommendations, objectives }
}

async function suggestEnemSkills(analysis: PlanningAnalysis, selection: CurriculumSelection): Promise<AdvisorRecommendations> {
  try {
    return await recommendEnemSkills(analysis, selection, async (prompt) => {
      const result = await generateValidatedStructuredContent({
        context: 'planning-advisor/enem-skills',
        prompt,
        responseSchema: SUGGESTIONS_RESPONSE_SCHEMA,
        zodSchema: suggestionsResultSchema,
        maxAttempts: 2,
      })
      return result.value
    })
  } catch (error) {
    console.warn('[planning-advisor] sugestões indisponíveis:', error instanceof Error ? error.message : error)
    return { status: 'indisponivel', message: 'Não foi possível obter as sugestões da IA agora. A análise acima continua válida; tente de novo em instantes.', chapters: [], remainingGaps: [], discardedCount: 0 }
  }
}

/** Texto oficial das habilidades BNCC que a planilha/planejamento traz só pelo código, para embasar os objetivos. */
async function bnccDescriptionsFor(analysis: PlanningAnalysis, selection: CurriculumSelection): Promise<Map<string, string>> {
  const targets = new Set(chaptersNeedingObjectives(analysis).map((chapter) => chapter.rowIndex))
  const codes = selection.units.filter((unit) => targets.has(unit.rowIndex))
    .flatMap((unit) => unit.habilidades.skills.slice(0, 10).filter((skill) => !skill.description?.trim()).map((skill) => skill.code))
  // Teto: o texto só melhora o embasamento; sem ele a IA trabalha com título e conteúdos.
  return codes.length ? resolveBnccDescriptions(codes.slice(0, 120)) : new Map()
}

async function suggestObjectives(analysis: PlanningAnalysis, selection: CurriculumSelection): Promise<ObjectiveRecommendations> {
  try {
    const descriptions = await bnccDescriptionsFor(analysis, selection).catch(() => new Map<string, string>())
    return await recommendObjectives(analysis, selection, descriptions, async (prompt) => {
      const result = await generateValidatedStructuredContent({
        context: 'planning-advisor/objectives',
        prompt,
        responseSchema: OBJECTIVES_RESPONSE_SCHEMA,
        zodSchema: objectivesResultSchema,
        maxAttempts: 2,
      })
      return result.value
    })
  } catch (error) {
    console.warn('[planning-advisor] objetivos indisponíveis:', error instanceof Error ? error.message : error)
    return { status: 'indisponivel', message: 'Não foi possível obter as sugestões de objetivos agora. Tente de novo em instantes.', chapters: [], discardedCount: 0 }
  }
}
