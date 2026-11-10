import type { Segment } from '@/types/exam'

export function isFundamentalOne(segment: Segment, gradeYear: number): boolean {
  return segment === 'anos-iniciais' && gradeYear >= 1 && gradeYear <= 5
}

export function fundamentalOneQuestionGuidance(segment: Segment, gradeYear: number): string {
  if (!isFundamentalOne(segment, gradeYear)) return ''
  return `FUNDAMENTAL I — SIMPLIFIQUE DE VERDADE: escreva para alunos do ${gradeYear}º ano. Use palavras comuns, frases curtas e uma tarefa direta. Prefira uma única operação ou comparação por questão; não junte conversão de partes, equivalência de áreas e cálculo em várias etapas. Use números pequenos e conhecimentos já ensinados até este ano. Evite enunciados abstratos, instruções escondidas, excesso de contexto e alternativas longas. Quando o conteúdo permitir, mostre a informação em um recurso visual que faça parte da atividade — por exemplo, malha quadriculada, objetos para contar, reta numérica, relógio, régua, mapa simples ou gráfico curto. O aluno deve precisar observar, contar, comparar ou medir esse recurso. Imagem decorativa não conta.`
}

const FUNDAMENTAL_ONE_VISUAL_TOPICS = /geometr|triang|poligon|angul|circunfer|area|malha|figura|fracao|reta numerica|grafico|tabela|mapa|relogio|calendario|moeda|cedula|solido|volume|perimetro|medida|comprimento|capacidade|massa/

export function shouldPreferFundamentalOneVisual(segment: Segment, gradeYear: number, title: string, content = ''): boolean {
  if (!isFundamentalOne(segment, gradeYear)) return false
  const normalized = `${title} ${content}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return FUNDAMENTAL_ONE_VISUAL_TOPICS.test(normalized)
}
