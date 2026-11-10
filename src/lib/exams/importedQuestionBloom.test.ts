import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ evaluate: vi.fn() }))
vi.mock('@/lib/ai/jevClient', () => ({ evaluateWithJev: mocks.evaluate }))
import { classifyImportedQuestionBloom, classifyQuestionBloom } from './importedQuestionBloom'
import { BLOOM_LEVELS, examQuestionSchema } from '@/lib/gemini/examSchema'
const question = examQuestionSchema.parse({ number: 1, source: 'acervo', type: 'objetiva', bloomLevel: 'compreender', statement: 'Calcule o dobro de cinco.', alternatives: [{ letter: 'A', text: '10' }, { letter: 'B', text: '5' }], correctLetter: 'A', bnccCodes: ['EF03MA01'], bnccStatus: 'mapeado', pedagogicalClassification: { dok: { categoryCode: 'DOK_1', confidence: 0, justification: '', evidence: '' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 0, justification: '', evidence: '' } } })
const context = { subject: 'Matemática', gradeYear: 3, segment: 'anos-iniciais' }
beforeEach(() => vi.clearAllMocks())
describe('Bloom das questões importadas', () => {
  it('oferece somente os seis níveis e seleciona o maior score mesmo com baixa confiança', async () => {
    mocks.evaluate.mockImplementation(async (request) => {
      expect(Object.keys(request.questions)).toEqual(BLOOM_LEVELS.map((level) => `q1_${level}`))
      expect(Object.values(request.questions as Record<string, { type: string }>).every((q) => q.type === 'score')).toBe(true)
      expect(JSON.stringify(request.state)).not.toContain('bloomLevel')
      return { source: 'provider', model: 'jev', answers: { q1_compreender: { type: 'score', score: 5, confidence: 0.9 }, q1_aplicar: { type: 'score', score: 8, confidence: 0.1 }, q1_criar: { type: 'score', score: 1 } } }
    })
    const [result] = await classifyImportedQuestionBloom([question], context)
    expect(result?.bloomLevel).toBe('aplicar')
    expect(result?.bloomAssessment).toMatchObject({ status: 'classified', confidence: 0.1, source: 'provider', scores: { aplicar: 8 } })
    expect(result?.statement).toBe(question.statement)
    expect(result?.correctLetter).toBe('A')
  })
  it('preserva ENEM e IA no classificador exclusivo do acervo', async () => {
    mocks.evaluate.mockResolvedValue({ source: 'cache', model: 'jev', answers: { q1_analisar: { type: 'score', score: 9 } } })
    const ai = { ...question, number: 2, source: 'ia' as const }
    const result = await classifyImportedQuestionBloom([{ ...question, source: 'enem_bank' }, ai], context)
    expect(result[0]?.bloomLevel).toBe(question.bloomLevel)
    expect(mocks.evaluate).not.toHaveBeenCalled()
    expect(result[1]).toBe(ai)
  })
  it('empates usam a ordem dos níveis sem criar pendência', async () => {
    mocks.evaluate.mockResolvedValue({ source: 'provider', model: 'jev', answers: { q1_aplicar: { type: 'score', score: 8 }, q1_analisar: { type: 'score', score: 8 } } })
    expect((await classifyImportedQuestionBloom([question], context))[0]?.bloomLevel).toBe('aplicar')
  })
  it('indisponibilidade preserva o nível existente com origem fallback explícita', async () => {
    mocks.evaluate.mockImplementation(async (request) => ({ source: 'fallback', model: 'jev', answers: request.fallback.answers }))
    const [result] = await classifyImportedQuestionBloom([question], context)
    expect(result?.bloomLevel).toBe('compreender')
    expect(result?.bloomAssessment).toMatchObject({ status: 'unavailable', source: 'fallback' })
    expect(Object.values(mocks.evaluate.mock.calls[0]![0].fallback.answers as Record<string, { choice?: string }>).some((a) => a.choice === 'pendente')).toBe(false)
  })
  it('não chama Jev quando não há questões importadas', async () => {
    await classifyImportedQuestionBloom([{ ...question, source: 'ia' }], context)
    expect(mocks.evaluate).not.toHaveBeenCalled()
  })
})

describe('Bloom de todas as origens', () => {
  it('reclassifica a questão de IA pelo conteúdo real, sem receber o nível sugerido', async () => {
    mocks.evaluate.mockResolvedValue({ source: 'provider', model: 'jev', answers: { q1_aplicar: { type: 'score', score: 9 } } })
    const ai = { ...question, source: 'ia' as const, bloomLevel: 'criar' as const }
    const [result] = await classifyQuestionBloom([ai], context)
    expect(result?.bloomLevel).toBe('aplicar')
    expect(result?.statement).toBe(ai.statement)
    expect(JSON.stringify(mocks.evaluate.mock.calls[0]![0].state)).not.toContain('bloomLevel')
  })
  it('não atribui Bloom como confirmado se o provedor não devolve scores', async () => {
    mocks.evaluate.mockResolvedValue({ source: 'provider', model: 'jev', answers: {} })
    const [result] = await classifyQuestionBloom([question], context)
    expect(result?.bloomLevel).toBe(question.bloomLevel)
    expect(result?.bloomAssessment?.status).toBe('unavailable')
  })
})

describe('integridade dos scores Bloom', () => {
  it.each([0, 10, -1])('não confirma Bloom com score inválido ou sem aderência: %s', async (score) => {
    mocks.evaluate.mockResolvedValue({ source: 'provider', model: 'jev', answers: { q1_criar: { type: 'score', score } } })
    const [result] = await classifyQuestionBloom([question], context)
    expect(result?.bloomLevel).toBe(question.bloomLevel)
    expect(result?.bloomAssessment?.status).toBe('unavailable')
  })
})

describe('preservação do banco ENEM', () => {
  it('exclui o ENEM de Bloom mesmo em prova mista com acervo e IA', async () => {
    const enem = { ...question, number: 3, source: 'enem_bank' as const }
    const ai = { ...question, number: 2, source: 'ia' as const }
    mocks.evaluate.mockResolvedValue({ source: 'provider', model: 'jev', answers: { q1_aplicar: { type: 'score', score: 9 }, q2_analisar: { type: 'score', score: 9 } } })
    const result = await classifyQuestionBloom([question, enem, ai], context)
    expect(result[1]).toBe(enem)
    expect(result[0]?.bloomLevel).toBe('aplicar')
    expect(result[2]?.bloomLevel).toBe('analisar')
    expect(mocks.evaluate.mock.calls[0]![0].state.questions.map((q: { id: string }) => q.id)).toEqual(['q1', 'q2'])
    expect(Object.keys(mocks.evaluate.mock.calls[0]![0].questions).some((key) => key.startsWith('q3_'))).toBe(false)
  })
})


it('aceita scores decimais reais do JEV e não favorece um score inteiro menor', async () => {
  mocks.evaluate.mockResolvedValue({ source: 'provider', model: 'jev-1.14.0', answers: {
    q1_criar: { type: 'score', score: 4 }, q1_aplicar: { type: 'score', score: 7.82 }, q1_analisar: { type: 'score', score: 6.37 },
  } })
  const [result] = await classifyQuestionBloom([question], { ...context, questions: [{ bloomLevel: 'criar' }], slots: ['dados desnecessários'] } as typeof context)
  expect(result?.bloomLevel).toBe('aplicar')
  expect(result?.bloomAssessment).toMatchObject({ status: 'classified', scores: { aplicar: 7.82 } })
  expect(mocks.evaluate.mock.calls[0]![0].state).not.toHaveProperty('slots')
  expect(mocks.evaluate.mock.calls[0]![0].context).not.toHaveProperty('questions')
})
