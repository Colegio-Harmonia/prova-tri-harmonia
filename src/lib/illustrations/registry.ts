import { blankCoordinatePlaneSchema, coordinatePlaneSchema, functionGraphSchema, type IllustrationGenerator } from './contracts'
import { renderFunctionGraph } from './mathFunctionGraph'
import { chartSchema, chemistrySchema, circuitSchema, mapSchema, phyloSchema, renderBlankCoordinatePlane, renderChart, renderChemistry, renderCircuit, renderCoordinatePlane, renderMap, renderPhylogeny } from './deterministicRenderers'

export const illustrationRegistry = {
  'math.coordinate_plane.blank': {
    id: 'math.coordinate_plane.blank',
    title: 'Plano cartesiano vazio',
    subject: 'matematica',
    parametersSchema: blankCoordinatePlaneSchema,
    render: renderBlankCoordinatePlane,
  },
  'math.coordinate_plane': {
    id: 'math.coordinate_plane',
    title: 'Plano cartesiano com pontos',
    subject: 'matematica',
    parametersSchema: coordinatePlaneSchema,
    render: renderCoordinatePlane,
  },
  'math.function.graph': {
    id: 'math.function.graph',
    title: 'Gráfico de função',
    subject: 'matematica',
    parametersSchema: functionGraphSchema,
    render: renderFunctionGraph,
  },
  'math.data.chart': { id: 'math.data.chart', title: 'Gráfico estatístico', subject: 'matematica', parametersSchema: chartSchema, render: renderChart },
  'geography.choropleth': { id: 'geography.choropleth', title: 'Mapa temático', subject: 'geografia', parametersSchema: mapSchema, render: renderMap },
  'history.historical-map': { id: 'history.historical-map', title: 'Mapa histórico (GeoJSON aprovado)', subject: 'historia', parametersSchema: mapSchema, render: renderMap },
  'biology.phylogeny': { id: 'biology.phylogeny', title: 'Cladograma', subject: 'biologia', parametersSchema: phyloSchema, render: renderPhylogeny },
  'chemistry.structure': { id: 'chemistry.structure', title: 'Estrutura química', subject: 'quimica', parametersSchema: chemistrySchema, render: renderChemistry },
  'physics.circuit': { id: 'physics.circuit', title: 'Circuito elétrico', subject: 'fisica', parametersSchema: circuitSchema, render: renderCircuit },
} as const satisfies Record<string, IllustrationGenerator>

export type IllustrationGeneratorId = keyof typeof illustrationRegistry

export function getIllustrationGenerator(id: string) {
  return illustrationRegistry[id as IllustrationGeneratorId] ?? null
}
