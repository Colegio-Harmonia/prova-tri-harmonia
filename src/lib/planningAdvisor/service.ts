import { getCurriculumForExam } from '@/lib/sheets/curriculumService'
import { llmAvailable } from '@/lib/gemini/llmClient'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import type { Segment } from '@/types/exam'
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
  /** Pede sugestões de habilidade ENEM à IA (só Ensino Médio). */
  withSuggestions: boolean
}

/**
 * Lê o planejamento do ANO INTEIRO (sem filtro de bimestre nem de Status
 * Cronograma), analisa e, se pedido, acrescenta sugestões da IA. Só leitura:
 * nada é gravado na planilha nem no banco de planejamento.
 */
export async function runPlanningAdvisor(params: PlanningAdvisorParams): Promise<PlanningAdvisorReport> {
  const selection = await getCurriculumForExam({ segment: params.segment, gradeYear: params.gradeYear, subject: params.subject })
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
