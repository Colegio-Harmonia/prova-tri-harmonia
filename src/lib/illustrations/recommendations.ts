import { z } from 'zod'
import { generateStructuredContent } from '@/lib/gemini/llmClient'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { extractSmilesLiteral } from '@/lib/images/technicalVisualRender'
import { getIllustrationGenerator, type IllustrationGeneratorId } from './registry'

const generatorIds = ['math.coordinate_plane', 'math.function.graph', 'math.data.chart', 'geography.choropleth', 'history.historical-map', 'biology.phylogeny', 'chemistry.structure', 'physics.circuit'] as const
const responseSchema = { type: 'object', properties: { recommendations: { type: 'array', items: { type: 'object', properties: { generator: { type: 'string', enum: generatorIds }, rationale: { type: 'string' }, parameters: { type: 'object' } }, required: ['generator', 'rationale', 'parameters'] } } }, required: ['recommendations'] }
const parsedSchema = z.object({ recommendations: z.array(z.object({ generator: z.enum(generatorIds), rationale: z.string().min(1).max(280), parameters: z.record(z.unknown()) })).max(3) })

export type IllustrationRecommendation = { generator: IllustrationGeneratorId; title: string; rationale: string; parameters: Record<string, unknown> }

export type IllustrationAnalysis = {
  decision: 'recommended' | 'not_needed' | 'missing_required_visual' | 'ai_optional'
  reason: string
  recommendations: IllustrationRecommendation[]
}

type CoordinatePoint = { label: string; x: number; y: number }

function normalizeSubject(subject: string): string {
  return subject.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

/** Extrai somente coordenadas escritas literalmente, como A(3, 4). */
export function extractLiteralCoordinatePoints(text: string): CoordinatePoint[] {
  const points = new Map<string, CoordinatePoint>()
  const coordinate = /\b([A-Z][A-Za-z0-9_]?)\s*\(\s*(-?\d+(?:[.,]\d+)?)\s*[,;]\s*(-?\d+(?:[.,]\d+)?)\s*\)/g
  for (const match of text.matchAll(coordinate)) {
    const x = Number(match[2].replace(',', '.'))
    const y = Number(match[3].replace(',', '.'))
    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 100 && Math.abs(y) <= 100) {
      points.set(match[1], { label: match[1], x, y })
    }
  }
  return [...points.values()]
}

/**
 * Recomendações sem IA são preferidas quando os dados já estão na questão.
 * Isso resolve imediatamente pontos e SMILES explícitos, sem risco de o
 * classificador omitir uma biblioteca que já pode renderizar o recurso.
 */
export function deterministicIllustrationRecommendations(subject: string, question: ExamQuestion): IllustrationRecommendation[] {
  const normalized = normalizeSubject(subject)
  const text = [question.statement, question.supportText, question.imageQuery, question.solutionBlueprint?.derivedAnswer]
    .filter((value): value is string => Boolean(value))
    .join('\n')

  if (normalized === 'matematica') {
    const points = extractLiteralCoordinatePoints(text)
    if (points.length >= 2) {
      const segments = points.length === 2 ? [{ from: points[0].label, to: points[1].label }] : []
      return [{
        generator: 'math.coordinate_plane',
        title: 'Plano cartesiano com pontos',
        rationale: `Os pontos ${points.map((point) => `${point.label}(${point.x}, ${point.y})`).join(' e ')} estão explícitos na questão; o diagrama ajuda a visualizar sem calcular a resposta.`,
        parameters: { points, segments },
      }]
    }
  }

  if (normalized === 'quimica') {
    const smiles = extractSmilesLiteral(text)
    if (smiles) {
      return [{
        generator: 'chemistry.structure',
        title: 'Estrutura química',
        rationale: 'O SMILES está explícito na questão e será validado pelo RDKit antes da renderização.',
        parameters: { smiles },
      }]
    }
  }
  return []
}

/** Referências que tornam a questão incompleta quando não há imagem vinculada. */
export function hasMissingRequiredVisual(question: ExamQuestion): boolean {
  if (question.image) return false
  const text = `${question.supportText ?? ''}\n${question.statement}`.toLowerCase()
  return /(?:figura|imagem|gráfico|mapa|diagrama)\s+(?:apresentad[oa]|abaixo|acima|a seguir)|(?:observe|analise)\s+(?:a\s+)?(?:figura|imagem|gráfico|mapa|diagrama)/.test(text)
}

function isPrimarilySymbolicMath(subject: string, question: ExamQuestion): boolean {
  if (normalizeSubject(subject) !== 'matematica') return false
  const text = `${question.supportText ?? ''}\n${question.statement}`.toLowerCase()
  return /regra de cramer|matriz inversa|determinante|proporç[aã]o|multiplica[rç][^\n]*cruz/.test(text)
}

function validatedRecommendation(subject: string, item: z.infer<typeof parsedSchema>['recommendations'][number]): IllustrationRecommendation | null {
  const generator = getIllustrationGenerator(item.generator)
  if (!generator || generator.subject !== normalizeSubject(subject)) return null
  const parsed = generator.parametersSchema.safeParse(item.parameters)
  if (!parsed.success) return null
  return { generator: item.generator, title: generator.title, rationale: item.rationale, parameters: parsed.data as Record<string, unknown> }
}

export async function analyzeIllustrations(subject: string, question: ExamQuestion): Promise<IllustrationAnalysis> {
  if (hasMissingRequiredVisual(question)) {
    return {
      decision: 'missing_required_visual',
      reason: 'A questão cita uma figura, imagem, gráfico, mapa ou diagrama que não foi fornecido. Não é seguro inventar esse recurso: recuse e gere uma nova questão, ou adicione uma fonte visual revisada.',
      recommendations: [],
    }
  }

  const deterministic = deterministicIllustrationRecommendations(subject, question)
  if (deterministic.length) {
    return {
      decision: 'recommended',
      reason: 'Há dados explícitos e verificáveis para gerar esta ilustração sem inventar informações.',
      recommendations: deterministic,
    }
  }

  if (isPrimarilySymbolicMath(subject, question)) {
    return {
      decision: 'not_needed',
      reason: 'Esta questão avalia um procedimento algébrico. Um gráfico ou diagrama não é necessário e pode até revelar a resposta esperada.',
      recommendations: [],
    }
  }

  const prompt = `Você seleciona ilustrações determinísticas para uma questão escolar. Só recomende uma ferramenta quando TODOS os parâmetros necessários estiverem explícitos na questão ou na ficha técnica. Nunca invente dados, coordenadas, SMILES, GeoJSON, componentes de circuito ou expressões. Se não houver visual determinístico confiável, devolva recommendations:[]; a opção de IA será exibida separadamente.

Disciplina: ${subject}
Questão: ${JSON.stringify({ statement: question.statement, supportText: question.supportText, alternatives: question.alternatives, solutionBlueprint: question.solutionBlueprint })}

Geradores: math.coordinate_plane requer points e segments; math.function.graph requer expression e domain; math.data.chart requer title,type,labels,values; chemistry.structure requer smiles; physics.circuit requer components; biology.phylogeny requer newick. Mapas exigem GeoJSON completo, então não recomende mapas sem ele.`
  const raw = parsedSchema.parse(await generateStructuredContent(prompt, responseSchema, 'illustrations/recommend'))
  const recommendations = raw.recommendations.map((item) => validatedRecommendation(subject, item)).filter((item): item is IllustrationRecommendation => Boolean(item))
  return recommendations.length
    ? { decision: 'recommended', reason: 'A análise encontrou um renderer compatível e recebeu parâmetros válidos para ele.', recommendations }
    : { decision: 'ai_optional', reason: 'Não há uma ilustração determinística segura para esta questão. Você pode manter a questão sem imagem ou pedir uma ilustração por IA, sem usar dados como se fossem exatos.', recommendations: [] }
}

/** Compatibilidade temporária para consumidores que só precisam da lista. */
export async function recommendIllustrations(subject: string, question: ExamQuestion): Promise<IllustrationRecommendation[]> {
  return (await analyzeIllustrations(subject, question)).recommendations
}
