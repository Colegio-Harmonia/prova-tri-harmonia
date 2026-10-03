import type { CanonicalDomainId } from './domains'

/**
 * Assunto de cada domínio calculável de Matemática, em palavras-chave tolerantes
 * (texto sem acento e em minúsculas). Servem para uma única pergunta: o capítulo
 * trata do assunto do domínio escolhido pela IA no plano?
 *
 * Sem esta checagem, geometria conceitual (triângulos, quadriláteros,
 * circunferências) era forçada em "distância entre pontos", "proporção" etc.: o
 * código recalculava uma grandeza que não era a da questão e a prova travava ou
 * saía com gabarito errado (lote #269, 03/10/2026).
 *
 * São palavras do TEMA, não discriminadores entre domínios parecidos (juros
 * simples/compostos, PA/PG): a escolha entre eles continua sendo da IA. Domínio
 * sem entrada aqui (Física, Química) não é verificado.
 */
const DOMAIN_TOPICS: Partial<Record<CanonicalDomainId, RegExp>> = {
  linear_system: /sistemas? (?:de|lineares?)|duas incognitas|metodo d[ae] (?:adicao|substituicao|comparacao)/,
  percentage: /porcentag|percent|desconto|acrescimo|\d\s*%/,
  ratio_proportion: /\brazao\b|\brazoes\b|proporc|regra de tres|\bescalas?\b|\btales\b|semelhanca/,
  simple_interest: /\bjuros\b|rendimento|\bcapital\b|financeir|emprestimo|investimento/,
  compound_interest: /\bjuros\b|montante|capitaliza|financeir|emprestimo|investimento/,
  arithmetic_progression: /progress\w* aritmetic|\bpa\b|sequenc|termo geral/,
  geometric_progression: /progress\w* geometric|\bpg\b|sequenc|termo geral/,
  linear_recurrence: /recorrenc|sequenc|fibonacci/,
  linear_recurrence_order2: /recorrenc|sequenc|fibonacci/,
  linear_function: /\bfunc(?:ao|oes)\b|funcoes afins|coeficiente angular|equacao d[ae] reta|grafico d[ae] (?:uma )?(?:equacao|funcao)|taxa de variacao/,
  quadratic_function: /\bfunc(?:ao|oes)\b|equacao do 2|parabola|bhaskara/,
  point_distance: /distancia entre (?:dois )?pontos|distancia d[eo] ponto|ponto medio/,
  circle_relative_position: /posicao relativa|posicoes relativas|circunferencias? (?:secantes|tangentes|externas|internas)/,
  sphere_point_position: /esfera/,
  rectangular_prism_volume: /prisma|paralelepipedo|bloco retangular|\bvolume\b/,
  average_speed: /velocidade|rapidez/,
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * `true`/`false` se o domínio tem regra de assunto e o conteúdo (título + tópicos
 * do capítulo) bate ou não; `null` quando o domínio não é verificado.
 */
export function domainFitsContent(domain: CanonicalDomainId, content: string): boolean | null {
  const topics = DOMAIN_TOPICS[domain]
  return topics ? topics.test(normalize(content)) : null
}
