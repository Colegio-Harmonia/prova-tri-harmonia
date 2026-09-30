import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { getIllustrationGenerator, type IllustrationGeneratorId } from './registry'

export type RoutedVisualPlan = {
  renderer: IllustrationGeneratorId
  parameters: Record<string, unknown>
}

/**
 * Decisão puramente em código: o modelo escolhe a necessidade pedagógica e
 * o tipo de visual; somente este roteador escolhe a biblioteca concreta.
 * Retornar null significa que não existe renderer determinístico seguro para
 * os dados recebidos — nunca uma tentativa de completar dados inventados.
 */
export function routeVisualPlan(subject: string, question: ExamQuestion): RoutedVisualPlan | null {
  const plan = question.visualPlan
  if (!plan?.required || !plan.visualType || !plan.parameters) return null

  const normalizedSubject = subject.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  const candidates: Partial<Record<NonNullable<typeof plan.visualType>, IllustrationGeneratorId>> = {
    blank_coordinate_plane: 'math.coordinate_plane.blank',
    coordinate_plane: 'math.coordinate_plane',
    function_graph: 'math.function.graph',
    statistical_chart: 'math.data.chart',
    chemical_structure: 'chemistry.structure',
    phylogeny: 'biology.phylogeny',
    map: normalizedSubject === 'historia' ? 'history.historical-map' : 'geography.choropleth',
  }
  const renderer = candidates[plan.visualType]
  if (!renderer) return null
  const generator = getIllustrationGenerator(renderer)
  const parsed = generator?.parametersSchema.safeParse(plan.parameters)
  if (!generator || !parsed?.success) return null
  return { renderer, parameters: parsed.data as Record<string, unknown> }
}
