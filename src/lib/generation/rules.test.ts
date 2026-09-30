import { describe, expect, it } from 'vitest'
import { getRuleEngine, hasRuleEngine, registeredRuleEngineIds } from './rules'

function evaluate(id: string, input: Record<string, unknown>) {
  const engine = getRuleEngine(id)
  if (!engine) throw new Error(`engine ausente: ${id}`)
  return engine.evaluate(input)
}

describe('motor de regras determinísticas de Português', () => {
  it('registra os cinco motores exigidos', () => {
    for (const id of ['conjugacao_verbal', 'concordancia_verbal', 'concordancia_nominal', 'ortografia', 'regencia_verbal', 'acentuacao']) {
      expect(hasRuleEngine(id)).toBe(true)
    }
    expect(registeredRuleEngineIds().length).toBeGreaterThanOrEqual(6)
  })

  it('conjuga verbos regulares nas três conjugações', () => {
    expect(evaluate('conjugacao_verbal', { verb: 'estudar', tense: 'presente', person: 'eu' }).correctForm).toBe('estudo')
    expect(evaluate('conjugacao_verbal', { verb: 'vender', tense: 'presente', person: 'nos' }).correctForm).toBe('vendemos')
    expect(evaluate('conjugacao_verbal', { verb: 'partir', tense: 'preterito_perfeito', person: 'eles' }).correctForm).toBe('partiram')
    expect(evaluate('conjugacao_verbal', { verb: 'estudar', tense: 'futuro_do_presente', person: 'tu' }).correctForm).toBe('estudarás')
  })

  it('conjuga verbos irregulares frequentes', () => {
    expect(evaluate('conjugacao_verbal', { verb: 'ser', tense: 'presente', person: 'eles' }).correctForm).toBe('são')
    expect(evaluate('conjugacao_verbal', { verb: 'fazer', tense: 'preterito_perfeito', person: 'eu' }).correctForm).toBe('fiz')
    expect(evaluate('conjugacao_verbal', { verb: 'ir', tense: 'presente', person: 'nos' }).correctForm).toBe('vamos')
  })

  it('concorda o verbo com o sujeito', () => {
    expect(evaluate('concordancia_verbal', { verb: 'estudar', tense: 'presente', subject: 'os alunos' }).correctForm).toBe('estudam')
    expect(evaluate('concordancia_verbal', { verb: 'ser', tense: 'presente', subject: 'nós' }).correctForm).toBe('somos')
    expect(evaluate('concordancia_verbal', { verb: 'partir', tense: 'presente', subject: 'o aluno' }).correctForm).toBe('parte')
  })

  it('flexiona adjetivos em gênero e número', () => {
    expect(evaluate('concordancia_nominal', { adjective: 'alto', gender: 'f', number: 'pl' }).correctForm).toBe('altas')
    expect(evaluate('concordancia_nominal', { adjective: 'feliz', gender: 'm', number: 'pl' }).correctForm).toBe('felizes')
    expect(evaluate('concordancia_nominal', { adjective: 'bom', gender: 'f', number: 'sg' }).correctForm).toBe('boa')
  })

  it('decide ortografia pela intenção', () => {
    expect(evaluate('ortografia', { rule: 'mas_mais', sense: 'adversativo' }).correctForm).toBe('mas')
    expect(evaluate('ortografia', { rule: 'mas_mais', sense: 'intensidade' }).correctForm).toBe('mais')
    expect(evaluate('ortografia', { rule: 'porque', sense: 'causa' }).correctForm).toBe('porque')
    expect(evaluate('ortografia', { rule: 'porque', sense: 'pergunta' }).correctForm).toBe('por que')
    expect(evaluate('ortografia', { rule: 'senao_se_nao', sense: 'excecao' }).correctForm).toBe('senão')
    expect(evaluate('ortografia', { rule: 'senao_se_nao', sense: 'condicao' }).correctForm).toBe('se não')
  })

  it('normaliza sinônimos pedagógicos da intenção ortográfica', () => {
    expect(evaluate('ortografia', { rule: 'mas_mais', sense: 'adversidade/oposição' }).correctForm).toBe('mas')
    expect(evaluate('ortografia', { rule: 'mas_mais', sense: 'oposição de sentidos entre orações' }).correctForm).toBe('mas')
    expect(evaluate('ortografia', { rule: 'porque', sense: 'causa/explicação' }).correctForm).toBe('porque')
  })

  it('resolve regência verbal e acentuação pelo lexicon', () => {
    expect(evaluate('regencia_verbal', { verb: 'assistir' }).correctForm).toContain('assistir a')
    expect(evaluate('acentuacao', { word: 'matematica' }).correctForm).toBe('matemática')
    expect(evaluate('acentuacao', { word: 'pais' }).correctForm).toBe('país')
  })

  it('rejeita entrada fora do contrato do motor', () => {
    expect(() => evaluate('conjugacao_verbal', { verb: 'estudar', tense: 'presente' })).toThrow()
    expect(() => evaluate('ortografia', { rule: 'inexistente', sense: 'x' })).toThrow()
    expect(() => evaluate('acentuacao', { word: 'zzzz' })).toThrow()
  })
})
