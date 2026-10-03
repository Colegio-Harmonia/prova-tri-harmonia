import { describe, expect, it } from 'vitest'
import { detectAlternativeAmbiguities } from './alternatives'
import { curriculumLeakageIssues } from './curriculumLeakage'
import { gateAnchoredClaim } from './gates'
import { StageGateError } from './types'
import type { TruthObject } from './types'

// Amostras reais capturadas em 03/10/2026 (lote #269, Matemática 8º ano, gpt-5-mini).

const truth = (sourceEvidence: string, claim = 'resposta'): TruthObject => ({
  strategy: 'fonte_ancorada', values: {}, derivation: 'x', sourceEvidence, claim,
})

describe('gateAnchoredClaim — evidência em frases não consecutivas', () => {
  const apoio = 'Leia o texto a seguir. A reta r tem equação y = -x + 2 e a reta s tem equação y = x - 1. O ponto P é a interseção de r e s. O ponto Q é a imagem de P pela translação que soma (1,2) às coordenadas.'

  it('aceita duas frases literais do apoio com a do meio omitida', () => {
    const evidence = 'A reta r tem equação y = -x + 2 e a reta s tem equação y = x - 1. O ponto Q é a imagem de P pela translação que soma (1,2) às coordenadas.'
    expect(() => gateAnchoredClaim(apoio, truth(evidence))).not.toThrow()
  })

  it('continua aceitando trecho contíguo', () => {
    expect(() => gateAnchoredClaim(apoio, truth('O ponto P é a interseção de r e s.'))).not.toThrow()
  })

  it('rejeita evidência com uma frase que não está no apoio (invenção)', () => {
    const evidence = 'A reta r tem equação y = -x + 2 e a reta s tem equação y = x - 1. Os pontos P e Q ficam sempre a 5 unidades de distância.'
    expect(() => gateAnchoredClaim(apoio, truth(evidence))).toThrow(StageGateError)
    try { gateAnchoredClaim(apoio, truth(evidence)) } catch (error) { expect((error as StageGateError).gate).toBe('evidence_not_found') }
  })

  it('rejeita evidência totalmente parafraseada', () => {
    expect(() => gateAnchoredClaim(apoio, truth('As duas retas se encontram em um ponto e depois ele é transladado.'))).toThrow(StageGateError)
  })
})

describe('detectAlternativeAmbiguities — alternativas matemáticas', () => {
  const correta = 'y = -x + 2; coeficiente angular -1: para cada aumento de 1 em x, y diminui 1; coeficiente linear 2: ponto em que a reta corta o eixo y.'
  const sinalTrocado = 'y = x + 2; coeficiente angular 1: para cada aumento de 1 em x, y aumenta 1; coeficiente linear 2: ponto em que a reta corta o eixo y.'

  it('não trata como "mesma resposta" alternativas que só diferem em sinais e números', () => {
    expect(detectAlternativeAmbiguities([{ letter: 'R', text: correta }, { letter: 'B', text: sinalTrocado }])).toEqual([])
  })

  it('continua barrando texto idêntico mesmo com a mesma matemática', () => {
    const issues = detectAlternativeAmbiguities([{ letter: 'A', text: correta }, { letter: 'B', text: correta }])
    expect(issues).toHaveLength(1)
  })

  it('continua barrando prosa quase igual sem números', () => {
    const issues = detectAlternativeAmbiguities([
      { letter: 'A', text: 'A fotossíntese converte energia luminosa em energia química nas plantas verdes' },
      { letter: 'B', text: 'A fotossíntese converte energia luminosa em energia química nas plantas verdes hoje' },
    ])
    expect(issues.length).toBeGreaterThan(0)
  })
})

describe('curriculumLeakageIssues — resposta matemática não é tautologia', () => {
  const objetiva = (statement: string, correct: string) => ({
    type: 'objetiva' as const,
    statement,
    supportText: null,
    alternatives: [{ letter: 'A', text: correct }, { letter: 'B', text: 'r: y = 2x + 1; s: y = 2x - 1; as retas são paralelas.' }],
    correctLetter: 'A',
    expectedAnswer: null,
  })

  it('equação com os mesmos nomes de reta da pergunta não é "só repete os termos"', () => {
    const question = objetiva('Considere as retas r e s. Determine as equações das retas e diga se as retas se cruzam.', 'r: y = 2x - 1; s: y = -2x + 1; as retas se cruzam.')
    expect(curriculumLeakageIssues(question, 'Gráfico de um sistema de equações').some((issue) => issue.code === 'tautological_answer')).toBe(false)
  })

  it('resposta em prosa que só repete a pergunta continua barrada', () => {
    const question = objetiva('Qual é a posição relativa entre as duas circunferências no plano?', 'A posição relativa entre as circunferências no plano')
    expect(curriculumLeakageIssues(question, 'Circunferências').some((issue) => issue.code === 'tautological_answer')).toBe(true)
  })
})
