import type { IllustrationGenerator } from './contracts'
import { renderFunctionGraph } from './mathFunctionGraph'

export const illustrationRegistry = {
  'math.function.graph': {
    id: 'math.function.graph',
    title: 'Gráfico de função',
    subject: 'matematica',
    render: renderFunctionGraph,
  },
} as const satisfies Record<string, IllustrationGenerator>

export type IllustrationGeneratorId = keyof typeof illustrationRegistry

export function getIllustrationGenerator(id: string) {
  return illustrationRegistry[id as IllustrationGeneratorId] ?? null
}
