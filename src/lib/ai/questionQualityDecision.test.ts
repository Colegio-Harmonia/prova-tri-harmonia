import { describe, expect, it, vi } from 'vitest'
import type { JevAnswers } from './jevClient'
import { evaluateQualityAnswers, judgeQuestionQuality } from './questionQualityDecision'
import { MULTIPLE_CORRECT_ALTERNATIVES, NO_CORRECT_ALTERNATIVE } from './questionQualityDecision'

const noul = (value: number) => ({ type: 'noul' as const, noul: value })
const good: JevAnswers = {
  resposta_substantiva: noul(0.97), copia_escopo_curricular: noul(0.1), apoio_autossuficiente: noul(0.95),
  resposta_exposta_enunciado: noul(0.05), informacao_suficiente: noul(0.95),
  alternativas_homogeneas: noul(0.8), resposta_unica: noul(0.95), fatos_corretos: noul(0.95), enunciado_coerente: noul(0.9),
  gabarito_independente: { type: 'choice', choice: 'A', confidence: 0.99 },
}

describe('evaluateQualityAnswers', () => {
  it('aprova questão boa sem apontar nada', () => {
    const result = evaluateQualityAnswers({ type: 'objetiva', correctLetter: 'A' }, good)
    expect(result.issues).toEqual([])
    expect(result.blocked).toBe(false)
    expect(result.answerKey?.matches).toBe(true)
  })

  it('bloqueia resposta que só repete o currículo (valores reais da Q7 do #391)', () => {
    const result = evaluateQualityAnswers({ type: 'objetiva', correctLetter: 'A' }, { ...good, resposta_substantiva: noul(0.08), copia_escopo_curricular: noul(0.95), resposta_unica: noul(0.22), fatos_corretos: noul(0.2) })
    expect(result.blocked).toBe(true)
    expect(result.issues.filter((i) => i.severity === 'bloqueante').map((i) => i.criterion)).toEqual(expect.arrayContaining(['resposta_substantiva', 'copia_escopo_curricular']))
  })

  it('não bloqueia só porque a cópia do escopo ficou em zona de alerta (controle 205)', () => {
    const result = evaluateQualityAnswers({ type: 'descritiva', correctLetter: null }, { resposta_substantiva: noul(0.97), copia_escopo_curricular: noul(0.58), apoio_autossuficiente: noul(0.89), fatos_corretos: noul(0.95), enunciado_coerente: noul(0.8), correcao_objetiva: noul(0.88) })
    expect(result.blocked).toBe(false)
    expect(result.issues.map((i) => i.severity)).toEqual(['alerta'])
  })

  it('bloqueia por indícios compostos quando nenhum critério isolado bloqueia (Q6 do #391)', () => {
    const result = evaluateQualityAnswers({ type: 'objetiva', correctLetter: 'A' }, { ...good, resposta_substantiva: noul(0.49), alternativas_homogeneas: noul(0.43), resposta_unica: noul(0.49), fatos_corretos: noul(0.48) })
    expect(result.blocked).toBe(true)
    expect(result.issues.some((i) => i.criterion === 'composto')).toBe(true)
  })

  it('bloqueia quando a conferência independente diverge do gabarito (Q5 do #391)', () => {
    const result = evaluateQualityAnswers({ type: 'objetiva', correctLetter: 'B' }, { ...good, gabarito_independente: { type: 'choice', choice: 'E', confidence: 0.96 } })
    expect(result.blocked).toBe(true)
    expect(result.answerKey).toMatchObject({ declaredLetter: 'B', independentLetter: 'E', matches: false })
  })

  it('distingue enunciado que entrega a resposta', () => {
    const result = evaluateQualityAnswers({ type: 'objetiva', correctLetter: 'A' }, { ...good, resposta_exposta_enunciado: noul(0.91) })
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ criterion: 'resposta_exposta_enunciado', severity: 'bloqueante' })]))
  })

  it('distingue nenhuma alternativa correta de múltiplas corretas', () => {
    const none = evaluateQualityAnswers({ type: 'objetiva', correctLetter: 'A' }, { ...good, gabarito_independente: { type: 'choice', choice: NO_CORRECT_ALTERNATIVE, confidence: 0.94 } })
    const multiple = evaluateQualityAnswers({ type: 'objetiva', correctLetter: 'A' }, { ...good, gabarito_independente: { type: 'choice', choice: MULTIPLE_CORRECT_ALTERNATIVES, confidence: 0.91 } })
    expect(none.issues[0]?.reason).toContain('nenhuma alternativa')
    expect(multiple.issues[0]?.reason).toContain('mais de uma alternativa')
  })

  it('exige critérios próprios da descritiva e ignora os de objetiva', () => {
    const result = evaluateQualityAnswers({ type: 'descritiva', correctLetter: null }, { resposta_substantiva: noul(0.9), copia_escopo_curricular: noul(0.1), apoio_autossuficiente: noul(0.9), fatos_corretos: noul(0.9), enunciado_coerente: noul(0.9), correcao_objetiva: noul(0.05), alternativas_homogeneas: noul(0.01) })
    expect(result.blocked).toBe(true)
    expect(result.scores.alternativas_homogeneas).toBeUndefined()
    expect(result.issues.map((i) => i.criterion)).toEqual(['correcao_objetiva'])
  })
})

describe('alinhamento_bncc', () => {
  it('bloqueia questão de memorização para habilidade de nível superior (valores do Q1 do #391)', () => {
    const result = evaluateQualityAnswers({ type: 'objetiva', correctLetter: 'A' }, { ...good, alinhamento_bncc: noul(0.11) })
    expect(result.blocked).toBe(true)
    expect(result.issues[0]).toMatchObject({ criterion: 'alinhamento_bncc', severity: 'bloqueante' })
  })

  it('só pergunta ao Jev quando há habilidade BNCC declarada, e envia a descrição', async () => {
    const evaluate = vi.fn().mockResolvedValue({ source: 'provider', answers: good, routing: { route: 'automatic', outcome: 'ok' }, model: 'm', stateHash: 'h', cacheKey: 'k' })
    const base = { subject: 'Ciências', gradeYear: 7, segment: 'anos-finais', curriculumScope: 'x', question: { type: 'objetiva' as const, statement: 'P?', supportText: null, correctLetter: 'A', expectedAnswer: null, gradingCriteria: null, alternatives: [{ letter: 'A', text: 'um' }, { letter: 'B', text: 'dois' }] } }
    await judgeQuestionQuality(base, { evaluate })
    expect(evaluate.mock.calls[0][0].questions.alinhamento_bncc).toBeUndefined()
    await judgeQuestionQuality({ ...base, skills: [{ code: 'EF07CI05', description: 'Discutir combustíveis.' }] }, { evaluate })
    expect(evaluate.mock.calls[1][0].questions.alinhamento_bncc).toBeDefined()
    expect(evaluate.mock.calls[1][0].state.habilidadeBncc).toEqual([{ codigo: 'EF07CI05', descricao: 'Discutir combustíveis.' }])
  })
})

describe('judgeQuestionQuality', () => {
  const input = {
    subject: 'Ciências', gradeYear: 7, segment: 'anos-finais', curriculumScope: 'Combustíveis renováveis',
    question: { type: 'objetiva' as const, statement: 'Pergunta?', supportText: null, correctLetter: 'A', expectedAnswer: null, gradingCriteria: null, alternatives: [{ letter: 'A', text: 'Resposta um' }, { letter: 'B', text: 'Resposta dois' }] },
  }

  it('falha aberta com alerta quando o Jev não responde, sem bloquear', async () => {
    const evaluate = vi.fn().mockResolvedValue({ source: 'fallback', answers: {}, routing: { route: 'fallback', outcome: 'x' }, model: 'm', stateHash: 'h', cacheKey: 'k' })
    const verdict = await judgeQuestionQuality(input, { evaluate })
    expect(verdict.available).toBe(false)
    expect(verdict.blocked).toBe(false)
    expect(verdict.issues[0]).toMatchObject({ severity: 'alerta', criterion: 'indisponivel' })
  })

  it('envia o escopo curricular e as alternativas ao Jev e avalia a resposta', async () => {
    const evaluate = vi.fn().mockResolvedValue({ source: 'provider', answers: good, routing: { route: 'automatic', outcome: 'ok' }, model: 'm', stateHash: 'h', cacheKey: 'k' })
    const verdict = await judgeQuestionQuality(input, { evaluate })
    const call = evaluate.mock.calls[0][0]
    expect(call.state.escopoCurricular).toBe('Combustíveis renováveis')
    expect(call.questions.gabarito_independente.criteria).toEqual({
      A: 'Resposta um',
      B: 'Resposta dois',
      [NO_CORRECT_ALTERNATIVE]: 'Nenhuma alternativa apresentada responde corretamente.',
      [MULTIPLE_CORRECT_ALTERNATIVES]: 'Mais de uma alternativa apresentada pode ser considerada correta.',
    })
    expect(call.state.alternativaCorreta).toBeUndefined()
    expect(verdict).toMatchObject({ available: true, blocked: false })
  })
})
