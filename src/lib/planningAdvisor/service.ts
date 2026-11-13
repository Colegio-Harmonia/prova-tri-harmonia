import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { llmAvailable } from '@/lib/gemini/llmClient'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import { TabResolutionError } from '@/lib/sheets/tabResolver'
import type { CurriculumSelection, Segment } from '@/types/exam'
import { SheetNotConfiguredError } from '@/config/gradeSheets'
import { combineSources, getBimesterPlanSelections } from './internalPlanSource'
import { analyzePlanning, type PlanningAnalysis } from './analyzePlanning'
import {
  recommendEnemSkills,
  SUGGESTIONS_RESPONSE_SCHEMA,
  suggestionsResultSchema,
  type AdvisorRecommendations,
} from './recommendations'

export type PlanningAdvisorReport = {
  analysis: PlanningAnalysis
  recommendations: AdvisorRecommendations | null
}

export type PlanningAdvisorParams = {
  segment: Segment
  gradeYear: number
  subject: string
  /** Ano letivo dos planejamentos internos a considerar; padrão: ano corrente. */
  academicYear?: number
  /** Pede sugestões de habilidade ENEM à IA (só Ensino Médio). */
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
  const academicYear = params.academicYear ?? new Date().getFullYear()
  const parts = await getBimesterPlanSelections(scope, academicYear)

  // Os quatro bimestres já estão no Planejamento: a planilha não é mais consultada.
  if (new Set(parts.map((part) => part.bimester)).size === 4) return combineSources(scope, parts, null)

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
  if (!params.withSuggestions || !analysis.enem) return { analysis, recommendations: null }

  if (!(await llmAvailable())) {
    return { analysis, recommendations: { status: 'indisponivel', message: 'A IA não está configurada neste ambiente; a análise acima não depende dela.', chapters: [], remainingGaps: [], discardedCount: 0 } }
  }

  try {
    const recommendations = await recommendEnemSkills(analysis, selection, async (prompt) => {
      const result = await generateValidatedStructuredContent({
        context: 'planning-advisor/enem-skills',
        prompt,
        responseSchema: SUGGESTIONS_RESPONSE_SCHEMA,
        zodSchema: suggestionsResultSchema,
        maxAttempts: 2,
      })
      return result.value
    })
    return { analysis, recommendations }
  } catch (error) {
    console.warn('[planning-advisor] sugestões indisponíveis:', error instanceof Error ? error.message : error)
    return { analysis, recommendations: { status: 'indisponivel', message: 'Não foi possível obter as sugestões da IA agora. A análise acima continua válida; tente de novo em instantes.', chapters: [], remainingGaps: [], discardedCount: 0 } }
  }
}
