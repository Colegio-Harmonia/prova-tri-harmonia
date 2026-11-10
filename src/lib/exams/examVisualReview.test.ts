import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocked = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('@/lib/gemini/structuredRepair', () => ({ generateValidatedStructuredContent: mocked.generate }))
import { referencesMissingVisual, reflectionVisualIssues, reviewExamVisuals } from './examVisualReview'
import type { ExamQuestion } from '@/lib/gemini/examSchema'

const context = { subject: 'Matemática', segment: 'anos-iniciais' as const, gradeYear: 4 }
const original: ExamQuestion = {
  slotId: 'q06', number: 6, type: 'objetiva', source: 'ia', weight: 10, curriculumUnitRowIndex: 2, bloomLevel: 'compreender',
  bnccCodes: ['EF04MA19'], bnccStatus: 'mapeado', statement: 'Na malha quadriculada, a figura A é um triângulo. Qual é sua imagem refletida?', supportText: null,
  alternatives: [{ letter: 'A', text: 'Um triângulo deslocado' }, { letter: 'B', text: 'Um triângulo espelhado' }], correctLetter: 'B', expectedAnswer: null, gradingCriteria: null,
  hasImage: false, imageDescription: null, needsImage: false, imageQuery: null,
  pedagogicalClassification: { dok: { categoryCode: 'DOK_1', confidence: 1, justification: 'Uma propriedade', evidence: 'triângulo' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 1, justification: 'Uma propriedade', evidence: 'triângulo' } },
  saeb: { applicable: false, source: null, value: null, approximate: false },
  generationContext: { subject: 'Matemática', educationContext: '4º ano do Ensino Fundamental brasileiro', bimester: 4, alternativesCount: 2, visualAid: 'auto', targetDifficulty: null },
}
const patch = { slotId: 'q06', statement: 'Observe o triângulo e a linha tracejada. Qual opção mostra o triângulo espelhado?', supportText: null,
  alternatives: [{ letter: 'A', text: 'Figura A' }, { letter: 'B', text: 'Figura B' }], correctLetter: 'B', expectedAnswer: null, gradingCriteria: null,
  hasImage: true, imageDescription: 'Malha com eixo vertical x=0. Triângulo original com vértices (-4,1),(-2,1),(-4,3). Opção A: translação para cima. Opção B: vértices (4,1),(2,1),(4,3), sem destaque de resposta.' }

describe('revisão visual da prova completa', () => {
  beforeEach(() => vi.clearAllMocks())
  it('preserva a questão do acervo sem chamar a IA para alterar conteúdo ou gabarito', async () => {
    const imported = { ...original, source: 'acervo' as const }
    expect((await reviewExamVisuals([imported], context)).questions).toEqual([imported])
    expect(mocked.generate).not.toHaveBeenCalled()
  })
  it('detecta referência a malha ausente e permite a mesma questão com imagem prevista', () => {
    expect(referencesMissingVisual(original)).toBe(true)
    expect(referencesMissingVisual({ ...original, hasImage: true })).toBe(false)
    expect(referencesMissingVisual({ ...original, statement: 'Quantos lados tem um triângulo?' })).toBe(false)
  })
  it('rejeita eixo incorreto e opções abstratas mesmo quando hasImage está verdadeiro', () => {
    const issues = reflectionVisualIssues({ ...original, hasImage: true, statement: 'Na malha, a figura A é um triângulo. A linha é seu eixo de simetria. Qual figura é seu reflexo?', imageDescription: 'Um triângulo e cinco opções de figuras.' })
    expect(issues).toHaveLength(4)
  })
  it('não confunde o verbo é com a letra E de uma figura', () => {
    expect(reflectionVisualIssues({ ...original, ...patch, statement: 'Qual figura é o reflexo da figura original?' })).toEqual([])
  })
  it('corrige imagem, enunciado e opções em lote, preservando o currículo e sincronizando os campos antigos', async () => {
    mocked.generate.mockImplementation(async (options) => {
      expect(options.context).toBe('generation/exam-visual-review')
      expect(options.prompt).toContain('4º ano')
      expect(options.prompt).toContain('eixo de reflexão do eixo de simetria')
      const checked = options.validate(options.zodSchema.parse({ questions: [patch] }))
      expect(checked.issues).toEqual([])
      return { value: checked.value, warnings: [] }
    })
    const result = await reviewExamVisuals([original], context)
    expect(result.questions[0]).toMatchObject({ number: 6, slotId: 'q06', bnccCodes: original.bnccCodes, bloomLevel: original.bloomLevel, hasImage: true, needsImage: true, imageDescription: patch.imageDescription, imageQuery: patch.imageDescription, statement: patch.statement })
    expect(mocked.generate).toHaveBeenCalledTimes(1)
  })
  it.each([
    { ...patch, hasImage: false, imageDescription: null },
    { ...patch, slotId: 'q07' },
    { ...patch, alternatives: [{ letter: 'C', text: 'Outra figura' }] },
    { ...patch, correctLetter: 'Z' },
  ])('rejeita revisão visual incoerente para correção limitada', async (badPatch) => {
    mocked.generate.mockImplementation(async (options) => {
      const checked = options.validate(options.zodSchema.parse({ questions: [badPatch] }))
      expect(checked.issues.length).toBeGreaterThan(0)
      expect(options.maxAttempts).toBe(2)
      throw new Error('Revisão recusada')
    })
    const result = await reviewExamVisuals([original], context)
    expect(result.questions[0]).toMatchObject({ ...original, visualReview: { status: 'pending' } })
    expect(result.warnings).toHaveLength(1)
  })
  it('preserva o rascunho e avisa quando o provedor está indisponível', async () => {
    mocked.generate.mockRejectedValue(new Error('Provedor indisponível'))
    const result = await reviewExamVisuals([original], context)
    expect(result.questions[0]).toMatchObject({ ...original, visualReview: { status: 'pending' } })
    expect(result.warnings).toHaveLength(1)
  })
  it('reutiliza questões já revisadas quando a fila retoma o mesmo rascunho', async () => {
    const saved = { ...original, visualReview: { status: 'complete' as const } }
    expect((await reviewExamVisuals([saved], context)).questions).toEqual([saved])
    expect(mocked.generate).not.toHaveBeenCalled()
  })
})
