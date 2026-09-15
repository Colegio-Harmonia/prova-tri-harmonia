import type { IllustrationGenerator } from './contracts'
import { renderFunctionGraph } from './mathFunctionGraph'
import { renderChart, renderChemistry, renderCircuit, renderMap, renderPhylogeny } from './deterministicRenderers'

export const illustrationRegistry = {
  'math.function.graph': {
    id: 'math.function.graph',
    title: 'Gráfico de função',
    subject: 'matematica',
    render: renderFunctionGraph,
  },
  'math.data.chart': { id: 'math.data.chart', title: 'Gráfico estatístico', subject: 'matematica', render: renderChart },
  'geography.choropleth': { id: 'geography.choropleth', title: 'Mapa temático', subject: 'geografia', render: renderMap },
  'history.historical-map': { id: 'history.historical-map', title: 'Mapa histórico (GeoJSON aprovado)', subject: 'historia', render: renderMap },
  'biology.phylogeny': { id: 'biology.phylogeny', title: 'Cladograma', subject: 'biologia', render: renderPhylogeny },
  'chemistry.structure': { id: 'chemistry.structure', title: 'Estrutura química', subject: 'quimica', render: renderChemistry },
  'physics.circuit': { id: 'physics.circuit', title: 'Circuito elétrico', subject: 'fisica', render: renderCircuit },
} as const satisfies Record<string, IllustrationGenerator>

export type IllustrationGeneratorId = keyof typeof illustrationRegistry

export function getIllustrationGenerator(id: string) {
  return illustrationRegistry[id as IllustrationGeneratorId] ?? null
}
