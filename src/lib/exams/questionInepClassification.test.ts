import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ evaluate: vi.fn(), select: vi.fn() }))
vi.mock('@/lib/ai/jevClient', () => ({ evaluateWithJev: mocks.evaluate }))
vi.mock('@/db/client', () => ({ db: { select: mocks.select } }))
import { classifyQuestionInep, classifyQuestionsInep, loadInepCatalog } from './questionInepClassification'
import { examQuestionSchema } from '@/lib/gemini/examSchema'

const context = { subject: 'História', segment: 'ensino-medio', gradeYear: 2 }
const question = examQuestionSchema.parse({ number: 1, source: 'ia', type: 'objetiva', bloomLevel: 'analisar',
  statement: 'Compare as fontes históricas e suas representações da cultura.', alternatives: [{ letter: 'A', text: 'Comparação das fontes' }], correctLetter: 'A',
  bnccCodes: [], bnccStatus: 'nao_mapeado', pedagogicalClassification: { dok: { categoryCode: 'DOK_2', confidence: 1, justification: '', evidence: '' }, soloExpected: { categoryCode: 'RELACIONAL', confidence: 1, justification: '', evidence: '' } },
})
const catalog = { matrix: 'enem' as const, approximate: false, referenceGrade: null, areas: [
  { code: 'CH', description: 'Ciências Humanas', children: [
    { code: 'C1', description: 'Compreender elementos culturais que constituem identidades.', children: [
      { code: 'H1', description: 'Interpretar fontes documentais acerca da cultura.' },
      { code: 'H4', description: 'Comparar pontos de vista em diferentes fontes sobre a cultura.' },
    ] },
    { code: 'C2', description: 'Espaço geográfico', children: [{ code: 'H6', description: 'Interpretar representações do espaço geográfico.' }] },
  ] },
  { code: 'MT', description: 'Matemática', children: [{ code: 'C1', description: 'Conhecimentos numéricos', children: [{ code: 'H1', description: 'Reconhecer números' }] }] },
] }
beforeEach(() => vi.clearAllMocks())
const answer = (choice: string, source = 'provider') => ({ source, model: 'jev', answers: { selection: { type: 'choice', choice, confidence: 0.9 } } })

describe('classificação INEP hierárquica', () => {
  it('restringe cada etapa aos filhos selecionados e persiste descrições do catálogo', async () => {
    mocks.evaluate.mockResolvedValueOnce(answer('CH')).mockResolvedValueOnce(answer('C1')).mockResolvedValueOnce(answer('H4'))
    const result = await classifyQuestionInep(question, context, catalog)
    expect(mocks.evaluate.mock.calls.map(([request]) => Object.keys(request.questions.selection.criteria))).toEqual([
      ['CH', 'MT'], ['C1', 'C2'], ['H1', 'H4'],
    ])
    expect(result.inepAssessment).toMatchObject({ status: 'classified', matrix: 'enem', area: { code: 'CH' }, competency: { code: 'C1' }, skill: { code: 'H4', description: catalog.areas[0]!.children[0]!.children[1]!.description } })
    expect(result.saeb).toMatchObject({ applicable: true, source: 'enem', approximate: false })
    expect(result.saeb.value).toContain('H4')
    expect(result.statement).toBe(question.statement)
    expect(result.correctLetter).toBe('A')
    expect(examQuestionSchema.parse(result)).toEqual(result)
  })
  it.each(['H6', 'inventado'])('recusa habilidade fora da competência: %s', async (code) => {
    mocks.evaluate.mockResolvedValueOnce(answer('CH')).mockResolvedValueOnce(answer('C1')).mockResolvedValueOnce(answer(code))
    const result = await classifyQuestionInep(question, context, catalog)
    expect(result.inepAssessment).toMatchObject({ status: 'unavailable', skill: null, errorCode: 'invalid_catalog_choice' })
    expect(result.saeb.applicable).toBe(false)
  })
  it('recusa abstenção em vez de aceitá-la como classificação concluída', async () => {
    mocks.evaluate.mockResolvedValueOnce(answer('CH')).mockResolvedValueOnce(answer('no_match'))
    const result = await classifyQuestionInep(question, context, catalog)
    expect(result.inepAssessment).toMatchObject({ status: 'unavailable', errorCode: 'invalid_catalog_choice' })
    expect(mocks.evaluate).toHaveBeenCalledTimes(2)
  })
  it('marca indisponibilidade sem usar fallback como decisão verdadeira', async () => {
    mocks.evaluate.mockResolvedValueOnce(answer('CH')).mockResolvedValueOnce(answer('C1', 'fallback'))
    const result = await classifyQuestionInep(question, context, catalog)
    expect(result.inepAssessment).toMatchObject({ status: 'unavailable', source: 'fallback', skill: null })
    expect(mocks.evaluate).toHaveBeenCalledTimes(2)
  })
  it('aplica SAEB por série e preserva aproximação fora do ano de referência', async () => {
    const ef = { subject: 'Matemática', segment: 'anos-finais', gradeYear: 7 }
    const saeb = await loadInepCatalog(ef)
    expect(saeb).toMatchObject({ matrix: 'classica', referenceGrade: 9, approximate: true })
    const topic = saeb!.areas[0]!.children![0]!
    mocks.evaluate.mockResolvedValueOnce(answer('Matemática')).mockResolvedValueOnce(answer(topic.code)).mockResolvedValueOnce(answer(topic.children![0]!.code))
    const result = await classifyQuestionInep(question, ef, saeb)
    expect(result.saeb).toMatchObject({ applicable: true, source: 'classica', approximate: true })
  })
  it.each([
    [{ subject: 'Matemática', segment: 'anos-iniciais', gradeYear: 2 }, 'novo_saeb', 2],
    [{ subject: 'História', segment: 'anos-iniciais', gradeYear: 5 }, 'novo_saeb', 5],
    [{ subject: 'Ciências', segment: 'anos-finais', gradeYear: 9 }, 'novo_saeb', 9],
  ])('usa o catálogo próprio para %j', async (ctx, matrix, referenceGrade) => {
    expect(await loadInepCatalog(ctx)).toMatchObject({ matrix, referenceGrade, approximate: false })
  })
  it('não inventa SAEB para disciplina sem cobertura', async () => {
    const [result] = await classifyQuestionsInep([question], { subject: 'Inglês', segment: 'anos-finais', gradeYear: 8 })
    expect(result?.inepAssessment?.status).toBe('not_applicable')
    expect(mocks.evaluate).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it('carrega vínculos reais do catálogo do banco', async () => {
    mocks.select.mockReturnValueOnce({ from: async () => [{ id: 1, code: 'CH', name: 'Ciências Humanas' }] })
      .mockReturnValueOnce({ from: async () => [{ id: 7, areaId: 1, number: 1, description: 'Cultura' }, { id: 8, areaId: 2, number: 2, description: 'Outra área' }] })
      .mockReturnValueOnce({ from: async () => [{ id: 10, competencyId: 7, code: 'H1', description: 'Fontes' }, { id: 11, competencyId: 8, code: 'H2', description: 'Outra competência' }] })
    const loaded = await loadInepCatalog(context)
    expect(loaded?.areas[0]?.children).toEqual([{ code: 'C1', description: 'Cultura', children: [{ code: 'H1', description: 'Fontes' }] }])
  })
  it('preserva a questão com pendência quando o banco não responde', async () => {
    mocks.select.mockImplementation(() => { throw new Error('offline') })
    const [result] = await classifyQuestionsInep([question], context)
    expect(result?.inepAssessment).toMatchObject({ status: 'unavailable', errorCode: 'official_catalog_unavailable' })
    expect(result?.statement).toBe(question.statement)
  })
  it('trata catálogo vazio como indisponível, sem decisão inventada', async () => {
    expect((await classifyQuestionInep(question, context, { ...catalog, areas: [] })).inepAssessment?.status).toBe('unavailable')
    expect(mocks.evaluate).not.toHaveBeenCalled()
  })
})

it('mantém a classificação INEP original do ENEM sem carregar catálogo ou chamar JEV', async () => {
  const enem = { ...question, source: 'enem_bank' as const, saeb: { applicable: true, source: 'enem' as const, value: 'H4 — Classificação existente', approximate: false } }
  const [result] = await classifyQuestionsInep([enem], context)
  expect(result).toBe(enem)
  expect(mocks.select).not.toHaveBeenCalled()
  expect(mocks.evaluate).not.toHaveBeenCalled()
})
