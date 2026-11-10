import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { examGenerationResultSchema, examQuestionSchema } from '@/lib/gemini/examSchema'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), generate: vi.fn(), set: vi.fn() }))
vi.mock('@/auth/auth', () => ({ auth: async () => ({ user: { email: 'reviewer@test.local' } }) }))
vi.mock('@/lib/exams/authorizeExamAccess', () => ({ authorizeExamAccess: mocks.authorize }))
vi.mock('@/lib/sheets/curriculumService', () => ({ getCurriculumForExam: async () => ({ subject: 'Matemática', segment: 'anos-iniciais', gradeYear: 3, units: [{ rowIndex: 0 }] }) }))
vi.mock('@/lib/exams/unifiedQuestionGeneration', () => ({ generateQuestionWithUnifiedFlow: mocks.generate }))
vi.mock('@/lib/exams/questionClassification', () => ({ classifyExamQuestions: async (questions: unknown[]) => questions }))
vi.mock('@/lib/exams/importedQuestionBloom', () => ({ classifyImportedQuestionBloom: async (questions: unknown[]) => questions }))
vi.mock('@/lib/exams/examVisualReview', () => ({ reviewExamVisuals: async (questions: unknown[]) => ({ questions, warnings: [] }) }))
vi.mock('@/lib/generation/coherence', () => ({ coherenceIssues: () => [] }))
vi.mock('@/lib/exams/wholeExamGeneration', () => ({
  classifyExamDifficulty: async (questions: unknown[]) => ({ questions, source: 'provider', model: 'jev', classifiedAt: '2026-10-26', distribution: {} }),
  assignExamPercentageWeights: (questions: unknown[]) => questions,
}))
vi.mock('@/lib/pedagogical/generatedQuestionClassificationService', () => ({ persistGeneratedQuestionClassifications: async () => ({ created: [] }) }))
vi.mock('@/lib/exams/questionQualityTest', () => ({ runQuestionQualityTest: async () => ({ report: [{ questionNumber: 1, approved: true }], warnings: [] }) }))
vi.mock('@/lib/exams/qualityReport', () => ({ mergeQualityResults: ({ payload }: { payload: unknown }) => payload }))
vi.mock('@/db/client', () => {
  const update = () => ({ set: (values: unknown) => {
    mocks.set(values)
    return { where: () => ({ returning: async () => [{ id: 31 }] }) }
  } })
  return { db: { update, transaction: async (run: (tx: unknown) => unknown) => run({ update }) } }
})

import { POST } from './route'

const original = examQuestionSchema.parse({
  number: 1, slotId: 'q01', type: 'objetiva', source: 'ia', bloomLevel: 'compreender', statement: 'Quanto é três mais três?',
  bnccCodes: ['EF03MA01'], bnccStatus: 'mapeado', curriculumUnitRowIndex: 0,
  pedagogicalClassification: {
    dok: { categoryCode: 'DOK_1', confidence: 0, justification: 'Revisar', evidence: '' },
    soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 0, justification: 'Revisar', evidence: '' },
  },
  alternatives: [{ letter: 'A', text: '6' }, { letter: 'B', text: '9' }], correctLetter: 'A',
  expectedAnswer: null, gradingCriteria: null,
  generationContext: { educationContext: '3º ano', subject: 'Matemática', bimester: 4, alternativesCount: 2, visualAid: 'auto', targetDifficulty: null },
})
const descriptive = examQuestionSchema.parse({
  ...original, source: 'acervo', type: 'descritiva', statement: 'Explique como somar três duas vezes.',
  alternatives: null, correctLetter: null, expectedAnswer: 'Somar 3 + 3 para obter 6.', gradingCriteria: 'Conferir com a resposta original.',
})

describe('substituição pelo outro tipo original do acervo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.generate.mockResolvedValue({ question: descriptive, warnings: [] })
  })
  it.each([
    ['whole-exam-v1', 'objetiva'], [undefined, 'objetiva'],
    ['whole-exam-v1', 'descritiva'], [undefined, 'descritiva'],
  ] as const)('preserva o tipo do banco no fluxo %s quando a posição era %s', async (engine, requestedType) => {
    const requested = requestedType === 'objetiva' ? original : { ...descriptive, source: 'ia' as const }
    const replacement = requestedType === 'objetiva' ? descriptive : { ...original, source: 'acervo' as const }
    mocks.generate.mockResolvedValue({ question: replacement, warnings: [] })
    const counts = { objectiveCount: replacement.type === 'objetiva' ? 1 : 0, discursiveCount: replacement.type === 'descritiva' ? 1 : 0 }
    const payload = examGenerationResultSchema.parse({ metadata: {
      generationEngine: engine, segment: 'anos-iniciais', gradeYear: 3, subject: 'Matemática', questionCount: 1, objectiveCount: requestedType === 'objetiva' ? 1 : 0, discursiveCount: requestedType === 'descritiva' ? 1 : 0, alternativesCount: 2,
    }, questions: [requested] })
    mocks.authorize.mockResolvedValue({ currentUser: { id: 8 }, exam: { id: 31, status: 'atribuido', segment: 'anos-iniciais', gradeYear: 3, academicYear: 2026, subject: 'Matemática', generationPayload: payload } })
    const response = await POST(new NextRequest('http://test.local/api/exams/31/regenerate-question', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionNumber: 1, sourcePreference: 'auto' }),
    }), { params: Promise.resolve({ examId: '31' }) })
    if (!response) throw new Error('A rota não retornou resposta.')
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(body.question).toMatchObject({ type: replacement.type, source: 'acervo', alternatives: replacement.alternatives, correctLetter: replacement.correctLetter, expectedAnswer: replacement.expectedAnswer })
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({
      ...counts,
      generationPayload: expect.objectContaining({ metadata: expect.objectContaining(counts) }),
    }))
    if (engine) expect(body.question.generationContext.alternativesCount).toBe(replacement.alternatives?.length ?? 0)
  })
})
