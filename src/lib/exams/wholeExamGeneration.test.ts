vi.mock('./questionBnccClassification', () => ({ classifyMissingQuestionBncc: async (questions: unknown[]) => questions }))
vi.mock('./importedQuestionBloom', () => ({ classifyImportedQuestionBloom: async (questions: unknown[]) => questions }))
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocked = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('@/lib/gemini/structuredRepair', () => ({ generateValidatedStructuredContent: mocked.generate }))
vi.mock('@/lib/ai/jevClient', () => ({ evaluateWithJev: vi.fn() }))
import { buildWholeExamBlueprint, generateWholeExam, normalizeWholeExamBlueprint, type WholeExamGenerationInput } from './wholeExamGeneration'

const input = (visualAid: 'auto' | 'obrigatorio' | 'sem_imagem'): WholeExamGenerationInput => ({
  subject: 'Matemática', segment: 'anos-iniciais', gradeYear: 4, questionCount: 1, alternativesCount: 4, objectiveCount: 1, discursiveCount: 0,
  slots: [{ number: 1, unitRowIndex: 0, type: 'objetiva', visualAid, targetBloomLevel: 'compreender', targetSkills: [], unitTitle: 'Geometria', curriculumContent: 'Figuras planas', enrichedContent: null, objectives: [] }],
})
const fields = (hasImage: boolean, imageDescription: string | null) => ({
  slotId: 'q01', statement: 'Quantos lados tem um triângulo?', supportText: null,
  alternatives: [{ letter: 'A', text: '2' }, { letter: 'B', text: '3' }, { letter: 'C', text: '4' }, { letter: 'D', text: '5' }], correctLetter: 'B', expectedAnswer: null, gradingCriteria: null, solutionBlueprint: null,
  pedagogicalClassification: { dok: { categoryCode: 'DOK_1', confidence: 1, justification: 'Identificar lados', evidence: 'Quantos lados' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 1, justification: 'Uma propriedade', evidence: 'lados' }, difficulty: null },
  hasImage, imageDescription,
})

describe('contrato visual da prova completa', () => {
  beforeEach(() => vi.clearAllMocks())
  it.each([['auto', null], ['obrigatorio', true], ['sem_imagem', false]] as const)('preserva a seleção docente %s no blueprint', (visualAid, expected) => {
    const question = buildWholeExamBlueprint(input(visualAid)).questions[0]
    expect(question.hasImage).toBe(expected)
    expect(question.generationContext.visualAid).toBe(visualAid)
  })
  it.each([
    ['auto', false, null, false],
    ['obrigatorio', false, null, true],
    ['obrigatorio', true, 'Um triângulo com contorno simples, sem destacar a resposta.', false],
    ['sem_imagem', true, 'Um triângulo.', true],
  ] as const)('valida %s com imagem=%s sem impedir correção', async (visualAid, hasImage, description, shouldReject) => {
    mocked.generate.mockImplementationOnce(async (options) => {
      expect(options.maxAttempts).toBe(2)
      expect(options.prompt).toContain('obrigatorio exige hasImage:true')
      const parsed = options.zodSchema.parse({ questions: [fields(hasImage, description)] })
      const checked = options.validate(parsed)
      expect(checked.issues.length > 0).toBe(shouldReject)
      expect(checked.stopRetry).toBe(false)
      return { value: checked.value, warnings: [], attempts: 1, repaired: false }
    })
    await generateWholeExam(input(visualAid))
  })
})

describe('ficha de cálculo vazia (prova sem cálculo, ex.: Inglês)', () => {
  it('vira null em vez de derrubar a resposta inteira', () => {
    const empty = { statement: 'x', solutionBlueprint: { domain: '', variables: [], equations: [], values: {}, calculationSteps: [], derivedAnswer: '', visualSpec: null } }
    expect(normalizeWholeExamBlueprint(empty).solutionBlueprint).toBeNull()
    expect(normalizeWholeExamBlueprint({ statement: 'x', solutionBlueprint: { calculationSteps: [' '] } }).solutionBlueprint).toBeNull()
  })
  it('ficha de Matemática com equações/valores mas sem passos continua para a IA completar', () => {
    const incomplete = { solutionBlueprint: { equations: ['A = b * h'], values: { b: 3, h: 4 }, calculationSteps: [] } }
    expect(normalizeWholeExamBlueprint(incomplete).solutionBlueprint).not.toBeNull()
  })
  it('ficha completa só tem os números normalizados', () => {
    const full = { solutionBlueprint: { equations: ['A = b * h'], values: { b: '3', h: 4 }, calculationSteps: ['3 * 4 = 12'] } }
    const result = normalizeWholeExamBlueprint(full).solutionBlueprint as { values: Record<string, unknown>; calculationSteps: string[] }
    expect(result.calculationSteps).toEqual(['3 * 4 = 12'])
    expect(result.values.h).toBe(4)
  })
})
