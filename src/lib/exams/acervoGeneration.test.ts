vi.mock('./questionBnccClassification', () => ({ classifyMissingQuestionBncc: async (questions: unknown[]) => questions }))
vi.mock('./importedQuestionBloom', () => ({ classifyImportedQuestionBloom: async (questions: unknown[]) => questions }))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ generate: vi.fn(), search: vi.fn() }))
vi.mock('@/lib/gemini/structuredRepair', () => ({ generateValidatedStructuredContent: mocks.generate }))
vi.mock('@/lib/ai/jevClient', () => ({ evaluateWithJev: vi.fn() }))
vi.mock('./acervoQuestions', () => ({ findAcervoQuestion: mocks.search, createAcervoSearchSession: () => ({ stats: {} }) }))
import { generateWholeExam, type WholeExamGenerationInput } from './wholeExamGeneration'
import { examQuestionSchema } from '@/lib/gemini/examSchema'
const classification = {
  dok: { categoryCode: 'DOK_1', confidence: 0, justification: 'Revisar', evidence: '' },
  soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 0, justification: 'Revisar', evidence: '' },
}
const imported = (number = 1) => examQuestionSchema.parse({ number, slotId: `q0${number}`, source: 'acervo', type: 'objetiva', bloomLevel: 'compreender', statement: `Enunciado original ${number}`, bnccCodes: ['EF03MA01'], bnccStatus: 'mapeado', pedagogicalClassification: classification, alternatives: [{ letter: 'A', text: '1' }, { letter: 'B', text: '2' }], correctLetter: 'A' })
const input: WholeExamGenerationInput = {
  subject: 'Matemática', segment: 'anos-iniciais', gradeYear: 3, questionCount: 2, alternativesCount: 4, objectiveCount: 2, discursiveCount: 0,
  slots: [1, 2].map((number) => ({ number, unitRowIndex: 1, type: 'objetiva', visualAid: 'auto', targetBloomLevel: 'compreender', targetSkills: [], unitTitle: 'Números', curriculumContent: 'Números', enrichedContent: null, objectives: [] })),
}
beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())
describe('seleção do acervo antes da IA', () => {
  it('usa objetiva em posição dissertativa antes da IA e atualiza o blueprint', async () => {
    mocks.search.mockResolvedValueOnce({ question: imported(1), reason: '' }).mockResolvedValueOnce({ question: imported(2), reason: '' })
    const request: WholeExamGenerationInput = {
      ...input, objectiveCount: 1, discursiveCount: 1,
      slots: input.slots.map((slot) => slot.number === 2 ? { ...slot, type: 'descritiva' } : slot),
    }
    const result = await generateWholeExam(request)
    expect(result.questions.map((question) => question.source)).toEqual(['acervo', 'acervo'])
    expect(result.questions.map((question) => question.type)).toEqual(['objetiva', 'objetiva'])
    expect(result.blueprint.metadata).toMatchObject({ objectiveCount: 2, discursiveCount: 0 })
    expect(result.blueprint.questions[1]).toMatchObject({ type: 'objetiva', generationContext: { alternativesCount: 4 } })
    expect(request.slots[1]?.type).toBe('descritiva')
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('mantém a dissertativa importada na posição objetiva e atualiza a composição real', async () => {
    const descriptive = examQuestionSchema.parse({ ...imported(2), type: 'descritiva', alternatives: null, correctLetter: null, expectedAnswer: 'Resposta original.', gradingCriteria: 'Conferir a resposta original.' })
    mocks.search.mockResolvedValueOnce({ question: imported(1), reason: '' }).mockResolvedValueOnce({ question: descriptive, reason: '' })
    const result = await generateWholeExam(input)
    expect(result.questions.map((question) => question.type)).toEqual(['objetiva', 'descritiva'])
    expect(result.blueprint.metadata).toMatchObject({ questionCount: 2, objectiveCount: 1, discursiveCount: 1 })
    expect(result.blueprint.questions[1]).toMatchObject({ type: 'descritiva', alternatives: null, generationContext: { alternativesCount: 0 } })
    expect(result.questions[1]).toMatchObject({ source: 'acervo', expectedAnswer: 'Resposta original.', generationContext: { alternativesCount: 0 } })
    expect(input.slots[1]?.type).toBe('objetiva')
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('inicia a busca de todas as vagas antes de aguardar a primeira importação', async () => {
    const releases: Array<() => void> = []
    mocks.search.mockImplementation(({ number }) => new Promise((resolve) => releases.push(() => resolve({ question: imported(number), reason: '' }))))
    const pending = generateWholeExam(input)
    await vi.waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2))
    releases.forEach((release) => release())
    expect((await pending).questions.map((q) => q.number)).toEqual([1, 2])
    mocks.search.mockReset()
  })
  it('preenche todos os slots sem chamar o gerador', async () => {
    mocks.search.mockResolvedValueOnce({ question: imported(1), reason: '' }).mockResolvedValueOnce({ question: imported(2), reason: '' })
    const result = await generateWholeExam(input)
    expect(result.questions.map((q) => q.source)).toEqual(['acervo', 'acervo'])
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.search.mock.calls[1]![0].session).toBe(mocks.search.mock.calls[0]![0].session)
  })
  it('respeita a escolha de gerar com IA sem consultar o acervo', async () => {
    mocks.generate.mockImplementationOnce(async (options) => {
      const parsed = options.zodSchema.parse({ questions: [{ slotId: 'q01', statement: 'Quanto é quatro mais um?', supportText: null, alternatives: [{ letter: 'A', text: '1' }, { letter: 'B', text: '2' }, { letter: 'C', text: '3' }, { letter: 'D', text: '5' }], correctLetter: 'D', expectedAnswer: null, gradingCriteria: null, solutionBlueprint: null, pedagogicalClassification: classification, hasImage: false, imageDescription: null }] })
      return { value: options.validate(parsed).value }
    })
    const result = await generateWholeExam({ ...input, questionSource: 'ia', slots: [input.slots[0]!], questionCount: 1, objectiveCount: 1 })
    expect(mocks.search).not.toHaveBeenCalled()
    expect(result.questions[0]?.source).toBe('ia')
  })
  it('gera com IA somente os slots sem questão utilizável', async () => {
    mocks.search.mockResolvedValueOnce({ question: imported(1), reason: '' }).mockResolvedValueOnce({ question: null, reason: 'Acervo sem questões.' })
    mocks.generate.mockImplementationOnce(async (options) => {
      expect(options.prompt).toContain('Quantidade: 1')
      expect(options.prompt).toContain('Enunciado original 1')
      const parsed = options.zodSchema.parse({ questions: [{ slotId: 'q02', statement: 'Quanto é dois mais dois?', supportText: null, alternatives: [{ letter: 'A', text: '1' }, { letter: 'B', text: '2' }, { letter: 'C', text: '3' }, { letter: 'D', text: '4' }], correctLetter: 'D', expectedAnswer: null, gradingCriteria: null, solutionBlueprint: null, pedagogicalClassification: classification, hasImage: false, imageDescription: null }] })
      return { value: options.validate(parsed).value }
    })
    const result = await generateWholeExam(input)
    expect(result.questions.map((q) => q.source)).toEqual(['acervo', 'ia'])
    expect(result.questions[1]?.acervoFallbackReason).toContain('sem questões')
    expect(mocks.generate).toHaveBeenCalledTimes(1)
  })
})
