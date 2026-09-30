import { describe, expect, it } from 'vitest'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { diversityIssues } from './coherence'
import { detectAlternativeAmbiguities } from './alternatives'
import { coherenceIssues, detectExamOverlaps } from './coherence'
import { sameNumber, textSimilarity } from './similarity'

describe('similaridade determinística', () => {
  it('reconhece números equivalentes em pt-BR', () => {
    expect(sameNumber('2,50', '2,5')).toBe(true)
    expect(sameNumber('1.200', '1200')).toBe(true)
    expect(sameNumber('3', '4')).toBe(false)
  })

  it('mede semelhança textual por termos', () => {
    expect(textSimilarity('A fotossíntese transforma energia luminosa em energia química', 'A fotossíntese transforma energia luminosa em energia química')).toBe(1)
    expect(textSimilarity('A capital da França é Paris', 'O rio Amazonas é o maior do Brasil')).toBe(0)
  })
})

describe('gate de ambiguidade por par de alternativas', () => {
  it('bloqueia alternativas duplicadas (normalizado)', () => {
    const issues = detectAlternativeAmbiguities([{ letter: 'A', text: 'São Paulo' }, { letter: 'B', text: ' sao paulo ' }])
    expect(issues.some((issue) => issue.severity === 'bloqueante')).toBe(true)
  })

  it('bloqueia valores numericamente equivalentes', () => {
    const issues = detectAlternativeAmbiguities([{ letter: 'A', text: '2,50 m' }, { letter: 'B', text: '2,5 m' }])
    expect(issues.some((issue) => issue.severity === 'bloqueante')).toBe(true)
  })

  it('bloqueia alternativas praticamente idênticas', () => {
    const issues = detectAlternativeAmbiguities([
      { letter: 'A', text: 'A fotossíntese transforma a energia luminosa em energia química nas plantas' },
      { letter: 'B', text: 'A fotossíntese transforma energia luminosa em energia química nas plantas verdes' },
    ])
    expect(issues.some((issue) => issue.severity === 'bloqueante')).toBe(true)
  })

  it('alerta quando o par só difere por negação', () => {
    const issues = detectAlternativeAmbiguities([
      { letter: 'A', text: 'A célula vegetal realiza fotossíntese e armazena amido' },
      { letter: 'B', text: 'A célula vegetal não realiza fotossíntese nem armazena amido' },
    ])
    expect(issues.some((issue) => issue.severity === 'alerta')).toBe(true)
  })

  it('não acusa alternativas realmente distintas', () => {
    const issues = detectAlternativeAmbiguities([
      { letter: 'A', text: 'O aumento da temperatura média global' },
      { letter: 'B', text: 'A redução da camada de ozônio' },
      { letter: 'C', text: 'A perda de biodiversidade marinha' },
    ])
    expect(issues).toEqual([])
  })
})

describe('coerência determinística da prova', () => {
  it('detecta questões com enunciados praticamente repetidos', () => {
    const issues = coherenceIssues([
      { number: 1, statement: 'Explique o processo de fotossíntese realizado pelas plantas clorofiladas' },
      { number: 2, statement: 'Explique o processo de fotossíntese realizado pelas plantas clorofiladas verdes' },
    ])
    expect(issues[0].severity).toBe('bloqueante')
    expect(issues[0].questionNumbers).toEqual([1, 2])
  })

  it('não acusa questões sobre assuntos distintos', () => {
    const issues = coherenceIssues([
      { number: 1, statement: 'Calcule a velocidade média de um carro que percorreu 120 km em 2 horas' },
      { number: 2, statement: 'Descreva as causas da Revolução Industrial na Inglaterra' },
    ])
    expect(issues).toEqual([])
  })

  it('ordena as sobreposições da mais parecida para a menos', () => {
    const overlaps = detectExamOverlaps([
      { number: 1, statement: 'Texto sobre ecossistema marinho costeiro brasileiro' },
      { number: 2, statement: 'Texto sobre ecossistema marinho costeiro brasileiro' },
      { number: 3, statement: 'Análise de gráfico sobre ecossistema marinho costeiro' },
    ])
    expect(overlaps[0].second).toBeGreaterThanOrEqual(overlaps[0].first)
    expect(overlaps.length).toBeGreaterThan(0)
  })
})

function mathQuestion(number: number, statement: string, values: Record<string, number>): ExamQuestion {
  return {
    number, source: 'ia', type: 'descritiva', bloomLevel: 'aplicar', statement, supportText: null,
    alternatives: null, correctLetter: null, expectedAnswer: '5', gradingCriteria: 'Teste',
    solutionBlueprint: { domain: 'point_distance', variables: [], equations: [], values, calculationSteps: ['Aplicar fórmula'], derivedAnswer: '5', visualSpec: 'none' },
    bnccCodes: [], bnccStatus: 'nao_mapeado', bnccSummary: null,
    pedagogicalClassification: { dok: { categoryCode: 'DOK_2', confidence: 1, justification: 'teste', evidence: 'teste' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 1, justification: 'teste', evidence: 'teste' } },
    saeb: { applicable: false, source: null, value: null, approximate: false }, needsImage: false, imageQuery: null, image: null, review: null,
  }
}

describe('diversidade pedagógica da prova', () => {
  it('bloqueia a mesma habilidade com os mesmos dados mesmo em formatos diferentes', () => {
    const issues = diversityIssues([
      mathQuestion(1, 'Calcule a distância entre A(3, 4) e B(7, 1).', { x1: 3, y1: 4, x2: 7, y2: 1 }),
      { ...mathQuestion(2, 'Qual é a distância entre os pontos A(3, 4) e B(7, 1)?', { x1: 3, y1: 4, x2: 7, y2: 1 }), type: 'objetiva', alternatives: [{ letter: 'A', text: '5' }], correctLetter: 'A', expectedAnswer: null, gradingCriteria: null },
    ])
    expect(issues.some((issue) => issue.severity === 'bloqueante' && issue.questionNumbers.includes(1) && issue.questionNumbers.includes(2))).toBe(true)
  })

  it('limita a repetição do mesmo método na prova', () => {
    const questions = [1, 2, 3].map((number) => mathQuestion(number, `Use a fórmula da distância entre pontos no plano cartesiano: caso ${number}.`, { x1: number, y1: 0, x2: number + 2, y2: 3 }))
    expect(diversityIssues(questions).some((issue) => issue.questionNumbers.includes(3))).toBe(true)
  })
})
