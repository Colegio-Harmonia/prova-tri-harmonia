import { describe, expect, it } from 'vitest'
import { domainFitsContent } from './domainFit'
import { validateAndEnrichBlueprint } from './blueprint'

// Capítulos reais do lote #269 (Matemática, 8º ano, 4º bimestre).
const COORDENADAS = '1.  Coordenadas cartesianas\n•  Coordenadas cartesianas\n•  Gráfico de uma equação do 1.º grau com duas incógnitas'
const TRIANGULOS = '3.  Triângulos\n•  Elementos dos triângulos e suas relações\n•  Classificação quanto aos lados e aos ângulos\n•  Mediana, altura, bissetriz e construções geométricas'
const QUADRILATEROS = '4.  Quadriláteros\n•  Elementos dos quadriláteros\n•  Soma dos ângulos internos e externos de um polígono qualquer'
const CIRCUNFERENCIAS = '1.  Definições e relações entre as circunferências\n•  Definições: circunferência e círculo\n•  Comprimento da circunferência e área do círculo\n•  Posições relativas entre duas circunferências'

describe('domainFitsContent', () => {
  it('barra domínios que não são o assunto do capítulo de geometria conceitual', () => {
    expect(domainFitsContent('point_distance', COORDENADAS)).toBe(false)
    expect(domainFitsContent('point_distance', QUADRILATEROS)).toBe(false)
    expect(domainFitsContent('ratio_proportion', TRIANGULOS)).toBe(false)
    expect(domainFitsContent('ratio_proportion', QUADRILATEROS)).toBe(false)
    expect(domainFitsContent('linear_function', CIRCUNFERENCIAS)).toBe(false)
  })

  it('aceita o domínio quando o capítulo trata do assunto', () => {
    expect(domainFitsContent('linear_function', COORDENADAS)).toBe(true)
    expect(domainFitsContent('linear_system', COORDENADAS)).toBe(true)
    expect(domainFitsContent('circle_relative_position', CIRCUNFERENCIAS)).toBe(true)
    expect(domainFitsContent('percentage', 'Porcentagem\n• Acréscimos e descontos')).toBe(true)
    expect(domainFitsContent('ratio_proportion', 'Razão e proporção\n• Regra de três')).toBe(true)
    expect(domainFitsContent('point_distance', 'Geometria analítica\n• Distância entre dois pontos')).toBe(true)
    expect(domainFitsContent('simple_interest', 'Educação financeira: juros simples e compostos')).toBe(true)
  })

  it('ignora acento e caixa', () => {
    expect(domainFitsContent('percentage', 'PORCENTAGEM E DESCONTOS')).toBe(true)
    expect(domainFitsContent('quadratic_function', 'Função Quadrática e parábola')).toBe(true)
  })

  it('não verifica domínios sem regra (Física, Química)', () => {
    expect(domainFitsContent('ohms_law', 'Qualquer capítulo')).toBeNull()
    expect(domainFitsContent('mole_calculation', 'Qualquer capítulo')).toBeNull()
  })
})

describe('validateAndEnrichBlueprint — domínio fora do assunto', () => {
  const params = {
    subject: 'Matemática',
    gradeYear: 8,
    segment: 'anos-finais' as const,
    slots: [
      { number: 1, unitRowIndex: 24, type: 'objetiva' as const, visualAid: 'auto' as const, curriculumContent: TRIANGULOS, unitTitle: '3. Triângulos' },
      { number: 2, unitRowIndex: 99, type: 'objetiva' as const, visualAid: 'auto' as const, curriculumContent: 'Porcentagem\n• Descontos', unitTitle: 'Porcentagem' },
    ],
  }

  it('rebaixa para fonte_ancorada o slot cujo domínio não é o assunto e mantém o que combina', () => {
    const { slots, issues } = validateAndEnrichBlueprint(params, {
      slots: [
        { slotNumber: 1, truthStrategy: 'calculavel', domain: 'ratio_proportion', difficulty: 'media', coreTopic: 'teorema da bissetriz' },
        { slotNumber: 2, truthStrategy: 'calculavel', domain: 'percentage', difficulty: 'facil', coreTopic: 'desconto' },
      ],
    })
    expect(slots[0]).toMatchObject({ truthStrategy: 'fonte_ancorada', domain: undefined, needsSupportText: true })
    expect(slots[1]).toMatchObject({ truthStrategy: 'calculavel', domain: 'percentage' })
    expect(issues).toEqual(['Slot 1: domínio "ratio_proportion" fora do assunto do capítulo; rebaixado para fonte_ancorada.'])
  })

  it('o aviso não usa as frases que o plano trata como bloqueantes (evita nova rodada de IA)', () => {
    const { issues } = validateAndEnrichBlueprint(params, {
      slots: [
        { slotNumber: 1, truthStrategy: 'calculavel', domain: 'ratio_proportion', difficulty: 'media', coreTopic: 'teorema da bissetriz' },
        { slotNumber: 2, truthStrategy: 'calculavel', domain: 'percentage', difficulty: 'facil', coreTopic: 'desconto' },
      ],
    })
    expect(issues.some((issue) => issue.includes('não corresponde') || issue.includes('não foi incluído'))).toBe(false)
  })
})
