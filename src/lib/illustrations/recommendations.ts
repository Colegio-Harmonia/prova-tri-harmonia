import { z } from 'zod'
import { generateStructuredContent } from '@/lib/gemini/llmClient'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { getIllustrationGenerator, type IllustrationGeneratorId } from './registry'

const generatorIds = ['math.function.graph', 'math.data.chart', 'geography.choropleth', 'history.historical-map', 'biology.phylogeny', 'chemistry.structure', 'physics.circuit'] as const
const responseSchema = { type: 'object', properties: { recommendations: { type: 'array', items: { type: 'object', properties: { generator: { type: 'string', enum: generatorIds }, rationale: { type: 'string' }, parameters: { type: 'object' } }, required: ['generator', 'rationale', 'parameters'] } } }, required: ['recommendations'] }
const parsedSchema = z.object({ recommendations: z.array(z.object({ generator: z.enum(generatorIds), rationale: z.string().min(1).max(280), parameters: z.record(z.unknown()) })).max(3) })

export type IllustrationRecommendation = { generator: IllustrationGeneratorId; title: string; rationale: string; parameters: Record<string, unknown> }

export async function recommendIllustrations(subject: string, question: ExamQuestion): Promise<IllustrationRecommendation[]> {
  const normalized = subject.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const prompt = `Você seleciona ilustrações determinísticas para uma questão escolar. Só recomende uma ferramenta quando TODOS os parâmetros necessários estiverem explícitos na questão ou na ficha técnica. Nunca invente dados, coordenadas, SMILES, GeoJSON, componentes de circuito ou expressões. Se não houver visual determinístico confiável, devolva recommendations:[]; a opção de IA será exibida separadamente.

Disciplina: ${subject}
Questão: ${JSON.stringify({ statement: question.statement, supportText: question.supportText, alternatives: question.alternatives, solutionBlueprint: question.solutionBlueprint })}

Geradores: math.function.graph requer expression e domain; math.data.chart requer title,type,labels,values; chemistry.structure requer smiles; physics.circuit requer components; biology.phylogeny requer newick. Mapas exigem GeoJSON completo, então não recomende mapas sem ele.`
  const raw = parsedSchema.parse(await generateStructuredContent(prompt, responseSchema, 'illustrations/recommend'))
  return raw.recommendations.flatMap((item) => {
    const generator = getIllustrationGenerator(item.generator)
    return generator?.subject === normalized ? [{ generator: item.generator, title: generator.title, rationale: item.rationale, parameters: item.parameters }] : []
  })
}
