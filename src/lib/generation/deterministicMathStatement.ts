import { formatNumber, normalizeSubject } from './domains'
import type { PipelineContext, QuestionPlan, StatementDraft, TruthObject, VisualPlan } from './types'

function value(values: Record<string, number>, key: string): string {
  return formatNumber(values[key])
}

function signedTerm(coefficient: number, variable: string, first = false): string {
  const absolute = formatNumber(Math.abs(coefficient))
  const term = `${absolute}${variable}`
  if (first) return coefficient < 0 ? `−${term}` : term
  return coefficient < 0 ? ` − ${term}` : ` + ${term}`
}

function statementVariant(ctx: PipelineContext, statement: string): string {
  // A variante é reproduzível e não introduz dados: usa a posição e o número
  // da candidata solicitado pelo montador para não repetir a mesma redação
  // quando o domínio aparece mais de uma vez na prova.
  const candidate = Number(ctx.contentPlanInstruction?.match(/candidata\s+(\d+)/i)?.[1] ?? 0)
  const variant = (ctx.questionNumber + candidate) % 3
  if (variant === 0) return statement
  if (variant === 1) return `Considere os dados a seguir. ${statement}`
  return `Com base nas informações fornecidas, ${statement.charAt(0).toLocaleLowerCase('pt-BR')}${statement.slice(1)}`
}

/**
 * Para Matemática calculável, a IA não redige o enunciado: ela poderia criar
 * dados novos e tornar um cálculo canônico inconsistente. Cada texto abaixo
 * só interpola entradas já aprovadas pelo domínio; o gate de fidelidade segue
 * sendo executado pelo orquestrador como defesa em profundidade.
 */
export function buildDeterministicMathStatement(
  ctx: PipelineContext,
  plan: QuestionPlan,
  truth: TruthObject,
  _visualPlan: VisualPlan,
): StatementDraft | null {
  if (normalizeSubject(ctx.subject) !== 'matematica' || plan.truthStrategy !== 'calculavel' || !plan.domain) return null

  const v = truth.values
  let statement: string
  switch (plan.domain) {
    case 'linear_system': {
      const first = `${signedTerm(v.a1, 'x', true)}${signedTerm(v.b1, 'y')} = ${value(v, 'c1')}`
      const second = `${signedTerm(v.a2, 'x', true)}${signedTerm(v.b2, 'y')} = ${value(v, 'c2')}`
      statement = `Resolva o sistema linear: ${first} e ${second}.`
      break
    }
    case 'percentage':
      statement = `De uma quantidade de ${value(v, 'base')} unidades, determine o valor correspondente a ${value(v, 'percent')}%.`
      break
    case 'ratio_proportion':
      statement = `Em uma relação de proporcionalidade direta, ${value(v, 'a')} corresponde a ${value(v, 'b')}. Mantendo a mesma razão, a qual valor corresponde ${value(v, 'c')}?`
      break
    case 'simple_interest':
      statement = `Um capital de R$ ${value(v, 'principal')} é aplicado a juros simples de ${value(v, 'rate')}% por período, durante ${value(v, 'time')} períodos. Determine apenas o juro obtido.`
      break
    case 'compound_interest':
      statement = `Um capital de R$ ${value(v, 'principal')} é aplicado a juros compostos de ${value(v, 'rate')}% por período, durante ${value(v, 'time')} períodos. Determine o montante final.`
      break
    case 'arithmetic_progression':
      statement = `Uma progressão aritmética tem primeiro termo ${value(v, 'a1')} e razão ${value(v, 'd')}. Determine o ${value(v, 'n')}º termo.`
      break
    case 'geometric_progression':
      statement = `Uma progressão geométrica tem primeiro termo ${value(v, 'a1')} e razão ${value(v, 'q')}. Determine o ${value(v, 'n')}º termo.`
      break
    case 'linear_recurrence':
      statement = `A sequência é definida por x₀ = ${value(v, 'a0')} e xₖ₊₁ = ${value(v, 'a')}·xₖ + ${value(v, 'b')}. Determine x${value(v, 'n')}.`
      break
    case 'linear_recurrence_order2':
      statement = `A sequência é definida por u₁ = ${value(v, 'firstTerm')}, u₂ = ${value(v, 'secondTerm')} e uₙ = ${value(v, 'previousCoefficient')}·uₙ₋₂ + ${value(v, 'currentCoefficient')}·uₙ₋₁. Determine u${value(v, 'termIndex')}.`
      break
    case 'linear_function':
      statement = `Considere a função f(x) = ${value(v, 'a')}x + ${value(v, 'b')}. Calcule f(${value(v, 'x')}).`
      break
    case 'quadratic_function':
      statement = `Considere a função f(x) = ${value(v, 'a')}x² + ${value(v, 'b')}x + ${value(v, 'c')}. Calcule f(${value(v, 'x')}).`
      break
    case 'point_distance':
      statement = `No plano cartesiano, determine a distância entre os pontos A(${value(v, 'x1')}, ${value(v, 'y1')}) e B(${value(v, 'x2')}, ${value(v, 'y2')}).`
      break
    case 'circle_relative_position':
      statement = `Duas circunferências têm raios ${value(v, 'r1')} e ${value(v, 'r2')}. A distância entre seus centros é ${value(v, 'distance')}. Classifique a posição relativa entre elas.`
      break
    case 'sphere_point_position':
      statement = `Uma esfera tem raio ${value(v, 'radius')}. Um ponto está a ${value(v, 'distance')} do centro. Classifique a posição do ponto em relação à esfera.`
      break
    case 'rectangular_prism_volume':
      statement = `Um prisma retangular tem comprimento ${value(v, 'length')}, largura ${value(v, 'width')} e altura ${value(v, 'height')}. Determine seu volume.`
      break
    case 'average_speed':
      statement = `Um percurso de ${value(v, 'distance')} km foi realizado em ${value(v, 'time')} h. Determine a velocidade média em km/h.`
      break
    default:
      return null
  }

  return { statement: statementVariant(ctx, statement), supportText: null }
}
