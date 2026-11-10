import { describe, expect, it, vi } from 'vitest'
import { candidateBnccSkills, classifyQuestionBncc, hasBnccCodes, selectBnccScores } from './questionBnccClassification'
import type { evaluateWithJev, JevAnswers } from '@/lib/ai/jevClient'
const context = { subject: 'Matemática', gradeYear: 2, segment: 'ensino-medio' }
const question = { statement: 'Interprete o gráfico e calcule a taxa de variação da função.', bnccCodes: [], correctLetter: 'A', alternatives: [{ letter: 'A', text: '2' }, { letter: 'B', text: '4' }] }

describe('BNCC múltipla pelo Jev', () => {
  it('avalia somente EM13 no Ensino Médio, independentemente da série', () => {
    for (const gradeYear of [1, 2, 3]) {
      const skills = candidateBnccSkills({ ...context, gradeYear })
      expect(skills.length).toBeGreaterThan(20)
      expect(skills.every((skill) => /^EM13MAT\d{3}$/.test(skill.code))).toBe(true)
      expect(skills.every((skill) => skill.text && skill.source && skill.dataVersion)).toBe(true)
    }
    const languages = candidateBnccSkills({ ...context, subject: 'linguagens' })
    expect(languages.some((skill) => skill.code.startsWith('EM13LP'))).toBe(true)
    expect(languages.some((skill) => skill.code.startsWith('EM13LGG'))).toBe(true)
  })
  it('respeita o ano e os blocos de anos do Ensino Fundamental', () => {
    const skills = candidateBnccSkills({ subject: 'Português', gradeYear: 5, segment: 'anos-iniciais' })
    expect(skills.some((skill) => skill.code.startsWith('EF05LP'))).toBe(true)
    expect(skills.some((skill) => skill.code.startsWith('EF15LP'))).toBe(true)
    expect(skills.every((skill) => skill.record.anos?.includes(5))).toBe(true)
  })
  it('seleciona todas acima de 80%, ordena por score e não força o maior quando insuficiente', () => {
    const result = selectBnccScores({ A: { type: 'score', score: 8 }, B: { type: 'score', score: 9 }, C: { type: 'score', score: 7 }, D: { type: 'score', score: 7.2 } }, ['A', 'B', 'C', 'D'])
    expect(result.selected.map((item) => item.code)).toEqual(['B', 'A'])
    expect(selectBnccScores({ A: { type: 'score', score: 6 } }, ['A']).selected).toEqual([])
  })
  it('descarta scores inválidos e códigos que não foram candidatos', () => {
    const { selected } = selectBnccScores({ A: { type: 'score', score: 100 }, B: { type: 'score', score: -1 }, invented: { type: 'score', score: 9 } }, ['A', 'B'])
    expect(selected).toEqual([])
  })
  it('consulta todos os candidatos oficiais e persiste descrições e pontuações', async () => {
    const evaluate = vi.fn(async (input) => {
      const answers: JevAnswers = Object.fromEntries(Object.keys(input.questions).map((code) => [code, { type: 'score', score: code === 'EM13MAT101' ? 9 : code === 'EM13MAT102' ? 8 : 2 }]))
      expect(input.state.skills.every((skill: { description: string }) => skill.description.length > 30)).toBe(true)
      return { source: 'provider', answers, model: 'jev-test' }
    })
    const result = await classifyQuestionBncc(question, context, { evaluate: evaluate as unknown as typeof evaluateWithJev })
    expect(result.bnccCodes).toEqual(['EM13MAT101', 'EM13MAT102'])
    expect(result.bnccDetails?.map((skill) => skill.code)).toEqual(result.bnccCodes)
    expect(result.bnccAssessment.scores).toHaveLength(candidateBnccSkills(context).length)
    expect(result.bnccAssessment.status).toBe('classified')
    expect(question.bnccCodes).toEqual([])
  })
  it('não grava um resultado parcial se um lote falhar', async () => {
    const evaluate = vi.fn().mockImplementationOnce(async (input) => ({ source: 'provider', model: 'jev', answers: Object.fromEntries(Object.keys(input.questions).map((code) => [code, { type: 'score', score: 9 }])) })).mockResolvedValue({ source: 'fallback', model: 'jev', answers: {}, failure: { category: 'provider_auth' } })
    const result = await classifyQuestionBncc(question, context, { evaluate })
    expect(result.bnccCodes).toEqual([])
    expect(result.bnccAssessment).toMatchObject({ status: 'unavailable', errorCode: 'provider_auth' })
  })
  it('identifica somente listas vazias como ausentes', () => {
    expect(hasBnccCodes({ bnccCodes: ['EM13MAT101'] })).toBe(true)
    expect(hasBnccCodes({ bnccCodes: ['', ' '] })).toBe(false)
  })
  it('registra explicitamente quando o catálogo não oferece habilidades para a disciplina e o ano', async () => {
    const evaluate = vi.fn()
    const result = await classifyQuestionBncc(question, { subject: 'Inglês', segment: 'anos-iniciais', gradeYear: 2 }, { evaluate })
    expect(evaluate).not.toHaveBeenCalled()
    expect(result.bnccAssessment).toMatchObject({ status: 'no_match', source: 'fallback', candidateCount: 0, errorCode: 'no_official_candidates' })
    expect(result.bnccCodes).toEqual([])
  })
})
