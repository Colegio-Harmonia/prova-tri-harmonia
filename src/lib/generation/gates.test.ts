import { describe, expect, it } from 'vitest'
import { assembleAlternatives, gateAlternativePresentation, gateAlternativeShape, gateDistractors, gateInterpretiveSupport, gateStatement, gateStrategy, gateTruth } from './gates'
import { StageGateError } from './types'
import type { PipelineContext, QuestionPlan, TruthObject } from './types'

const ctx: PipelineContext = {
  questionNumber: 1,
  subject: 'Matemática',
  gradeYear: 9,
  segment: 'anos-finais',
  curriculumContent: 'Capítulo: porcentagem e descontos.',
  questionType: 'objetiva',
}

const identityShuffle = <T,>(items: T[]): T[] => [...items]

describe('gates determinísticos', () => {
  it('Gate 0 bloqueia domínio sem recalculador (`other`)', () => {
    const plan = { truthStrategy: 'calculavel', domain: 'other' } as unknown as QuestionPlan
    expect(() => gateStrategy(ctx, plan)).toThrow(StageGateError)
  })

  it('Gate 0 bloqueia regra determinística sem motor registrado', () => {
    const plan: QuestionPlan = { truthStrategy: 'regra_deterministica', ruleId: 'concordancia' }
    expect(() => gateStrategy(ctx, plan)).toThrow(/motor de regras/i)
  })

  it('Gate 0 exige material para fonte_ancorada', () => {
    expect(() => gateStrategy({ ...ctx, curriculumContent: '' }, { truthStrategy: 'fonte_ancorada' })).toThrow(/material-fonte/i)
  })

  it('Gate 1 recalcula e fixa a resposta canônica (nunca a do modelo)', () => {
    const truth: TruthObject = { strategy: 'calculavel', domain: 'percentage', values: { base: 200, percent: 10 }, derivation: '' }
    gateTruth(ctx, { truthStrategy: 'calculavel', domain: 'percentage' }, truth)
    expect(truth.answerNumeric).toBe(20)
    expect(truth.derivedAnswer).toBe('20')
  })

  it('Gate 1 rejeita entrada que não forma o modelo', () => {
    const truth: TruthObject = { strategy: 'calculavel', domain: 'linear_system', values: { a1: 1, b1: 2, c1: 3, a2: 2, b2: 4, c2: 6 }, derivation: '' }
    expect(() => gateTruth(ctx, { truthStrategy: 'calculavel', domain: 'linear_system' }, truth)).toThrow(/recalculador/i)
  })

  it('Gate 1 rejeita evidência que não existe no material', () => {
    const plan: QuestionPlan = { truthStrategy: 'fonte_ancorada', sourceMaterial: 'A Revolução Francesa começou em 1789.' }
    const truth: TruthObject = { strategy: 'fonte_ancorada', values: {}, derivation: 'x', sourceEvidence: 'A independência do Brasil ocorreu em 1822.' }
    expect(() => gateTruth(ctx, plan, truth)).toThrow(/não existe literalmente/i)
  })

  it('Gate 1 aceita evidência literal do material', () => {
    const plan: QuestionPlan = { truthStrategy: 'fonte_ancorada', sourceMaterial: 'A Revolução Francesa começou em 1789, na França.' }
    const truth: TruthObject = { strategy: 'fonte_ancorada', values: {}, derivation: 'x', sourceEvidence: 'A Revolução Francesa começou em 1789' }
    expect(() => gateTruth(ctx, plan, truth)).not.toThrow()
  })

  it('Gate 3 rejeita número inventado na redação', () => {
    const truth: TruthObject = { strategy: 'calculavel', domain: 'percentage', values: { base: 200, percent: 10 }, derivation: '10% de 200 = 20', derivedAnswer: '20', answerNumeric: 20 }
    expect(() => gateStatement(ctx, { truthStrategy: 'calculavel', domain: 'percentage' }, truth, { statement: 'Um produto de 200 reais teve desconto de 10%, gerando 20 reais. Outro item de 350 reais...', supportText: null })).toThrow(/não existem no objeto-fonte/i)
    expect(() => gateStatement(ctx, { truthStrategy: 'calculavel', domain: 'percentage' }, truth, { statement: 'Um produto de 200 reais recebeu 10% de desconto. Qual o valor do desconto?', supportText: null })).not.toThrow()
  })

  it('Gate 2 rejeita distrator igual à resposta ou repetido', () => {
    const truth: TruthObject = { strategy: 'calculavel', domain: 'percentage', values: { base: 200, percent: 10 }, derivation: '', derivedAnswer: '20', answerNumeric: 20 }
    expect(() => gateDistractors({ truthStrategy: 'calculavel', domain: 'percentage' }, truth, ['20', '30', '40'], '20')).toThrow(/igual à resposta|reproduz numericamente/i)
    expect(() => gateDistractors({ truthStrategy: 'calculavel', domain: 'percentage' }, truth, ['30', '30', '40'], '20')).toThrow(/repetidos/i)
  })

  it('monta alternativas com a correta definida por código', () => {
    const { alternatives, correctLetter } = assembleAlternatives(['30', '40', '50'], '20', identityShuffle)
    expect(correctLetter).toBe('A')
    expect(alternatives[0].text).toBe('20')
    expect(alternatives.map((item) => item.letter)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('bloqueia alternativa que traz a linha final da resolução', () => {
    expect(() => gateAlternativePresentation('x5 = 730')).toThrow(/atribuição ou resolução/i)
    expect(() => gateAlternativePresentation('a8 = 5.743')).toThrow(/atribuição ou resolução/i)
    expect(() => gateAlternativePresentation('730')).not.toThrow()
  })

  it('bloqueia referência a campos internos no enunciado', () => {
    expect(() => gateStatement(ctx, { truthStrategy: 'interpretativa' }, { strategy: 'interpretativa', values: {}, derivation: '' }, { statement: 'Leia o trecho em supportText.', supportText: 'Um texto de apoio suficientemente longo para a questão, com informações completas e autocontidas para o estudante.' })).toThrow(/nome interno/i)
  })

  it('bloqueia alternativas com formatos incompatíveis', () => {
    expect(() => gateAlternativeShape('lindas', ['Selfie com minhas amigas: duas garotas muito lindo.', 'Selfie com minhas amigas: duas garotas muito lindíssimo.', 'Selfie com minhas amigas: duas garotas muito lindos.', 'Selfie com minhas amigas: duas garotas muito linda.'])).toThrow(/mesmo formato/i)
    expect(() => gateAlternativeShape('lindas', ['lindo', 'lindíssima', 'lindos', 'linda'])).not.toThrow()
  })

  it('Gate 0 aceita motor de regras registrado', () => {
    expect(() => gateStrategy(ctx, { truthStrategy: 'regra_deterministica', ruleId: 'conjugacao_verbal' })).not.toThrow()
  })

  it('Gate 1 decide a forma pelo motor de regras, não pelo modelo', () => {
    const truth: TruthObject = { strategy: 'regra_deterministica', values: {}, derivation: '', ruleInput: { verb: 'estudar', tense: 'presente', person: 'eu' } }
    gateTruth(ctx, { truthStrategy: 'regra_deterministica', ruleId: 'conjugacao_verbal' }, truth)
    expect(truth.derivedAnswer).toBe('estudo')
  })

  it('Gate 2 (interpretativa) rejeita distrator que é trecho literal do texto', () => {
    const plan: QuestionPlan = { truthStrategy: 'interpretativa', sourceMaterial: 'O personagem decidiu partir ao amanhecer. A cidade ficou silenciosa por muitos dias.' }
    const truth: TruthObject = { strategy: 'interpretativa', values: {}, derivation: 'x', textEvidence: 'O personagem decidiu partir ao amanhecer.', derivedAnswer: 'Ele decide ir embora cedo.' }
    expect(() => gateInterpretiveSupport(plan, truth, ['A cidade ficou silenciosa por muitos dias', 'Ele permanece na cidade'])).toThrow(/trecho literal/i)
    expect(() => gateInterpretiveSupport(plan, truth, ['Ele permanece na cidade', 'O personagem ganha dinheiro'])).not.toThrow()
  })
})
