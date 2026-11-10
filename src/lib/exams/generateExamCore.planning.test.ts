import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import type { CurriculumSelection } from '@/types/exam'
const mocks = vi.hoisted(() => ({ curriculum: vi.fn(), generate: vi.fn(), select: vi.fn(), bank: vi.fn(), insert: vi.fn() }))
vi.mock('@/db/client', () => ({ db: {
  query: { users: { findFirst: async () => ({ id: 1, role: 'professor', active: true }) } },
  transaction: async (run: (tx: unknown) => unknown) => run({ insert: () => ({ values: (value: unknown) => { mocks.insert(value); return { returning: async () => [{ id: 800 }] } } }) }),
} }))
vi.mock('@/lib/sheets/curriculumService', () => ({ getCurriculumForExam: mocks.curriculum }))
vi.mock('./plannedEnemSelection', () => ({ loadPlanningQuestionHistory: async () => [], loadPlannedEnemCandidates: async () => [], selectPlannedEnemQuestions: mocks.select }))
vi.mock('@/lib/gemini/enemBankMerge', () => ({ buildBankExamQuestions: mocks.bank }))
vi.mock('./wholeExamGeneration', () => ({ generateWholeExam: mocks.generate, classifyExamDifficulty: async (questions: ExamQuestion[]) => ({ questions, source: 'provider', model: 'test', classifiedAt: 'now', distribution: {} }), assignExamPercentageWeights: (questions: ExamQuestion[]) => questions }))
vi.mock('./examVisualReview', () => ({ reviewExamVisuals: async (questions: ExamQuestion[]) => ({ questions, warnings: [] }) }))
vi.mock('./questionClassification', () => ({ classifyExamQuestions: async (questions: ExamQuestion[]) => questions }))
vi.mock('./questionBnccClassification', () => ({ classifyMissingQuestionBncc: async (questions: ExamQuestion[]) => questions }))
vi.mock('./importedQuestionBloom', () => ({ classifyImportedQuestionBloom: async (questions: ExamQuestion[]) => questions }))
vi.mock('@/lib/pedagogical/generatedQuestionClassificationService', () => ({ persistGeneratedQuestionClassifications: async () => ({ created: [] }) }))
import { generateExamCore } from './generateExamCore'

const question = (number: number, source: ExamQuestion['source'] = 'ia'): ExamQuestion => ({ number, source, type: 'objetiva', statement: `Questão ${number}`, bloomLevel: 'compreender', bnccCodes: [], bnccStatus: 'nao_mapeado', alternatives: 'ABCDE'.split('').map((letter) => ({ letter, text: letter })), correctLetter: 'A', pedagogicalClassification: { dok: { categoryCode: 'DOK_1', confidence: 1, justification: '', evidence: '' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 1, justification: '', evidence: '' } }, saeb: { applicable: false, approximate: false }, needsImage: false, ...(source === 'enem_bank' ? { enemBankRef: { questionId: number, year: 2024 } } : {}) })
const curriculum: CurriculumSelection = { planReference: { planId: 105, versionId: 113, versionNumber: 3 }, segment: 'ensino-medio', gradeYear: 1, subject: 'Inglês', bimester: 4, tabName: 'Plano aprovado', unmappedWarnings: [], units: [0, 1].map((rowIndex) => ({ rowIndex, bimestre: '4', tituloCapitulo: `Reading ${rowIndex}`, conteudo: 'Vocabulary', objetivos: [], objetivosColumnMissing: true, habilidades: { status: 'nao_mapeado', skills: [] }, enemSkills: { invalid: [], skills: [{ code: 'C2:H5', competency: 2, skill: 5, description: 'Associar vocabulário ao tema', count: 1, sources: [] }] } })) }
const request = { segment: 'ensino-medio' as const, gradeYear: 1, academicYear: 2026, subject: 'Inglês', bimester: 4, curriculumPlanId: 105, curriculumPlanVersionId: 113, questionCount: 8, enemBankQuestionIds: [101, 102, 103, 104], contentPlanIncludesEnem: true, objectivePercentage: 100, contentPlan: [0, 1].map((unitRowIndex) => ({ unitRowIndex, questionCount: 6, priority: 'media' as const, visualAid: 'auto' as const })) }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.curriculum.mockResolvedValue(curriculum)
  mocks.bank.mockImplementation(async (ids: number[]) => ids.map((id) => question(id, 'enem_bank')))
  mocks.select.mockResolvedValue({ assignments: [101, 102, 103, 104].map((questionId, i) => ({ questionId, slotNumber: [1, 2, 7, 8][i], alignment: { status: 'aligned', evidence: 'Compatível', model: 'test', checkedAt: 'now' } })), warnings: [] })
  mocks.generate.mockImplementation(async (input: { slots: Array<{ number: number; unitRowIndex: number }> }) => ({ questions: input.slots.map((slot) => ({ ...question(slot.number), curriculumUnitRowIndex: slot.unitRowIndex })) }))
})

describe('montagem completa com ENEM dentro do planejamento', () => {
  it('12 no total = 4 ENEM + 8 restantes, preservando as 6 posições de cada capítulo e a versão', async () => {
    const result = await generateExamCore(request, 1)
    expect(result.exam.questions).toHaveLength(12)
    expect(result.exam.questions.map((q) => q.number)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect(result.exam.questions.filter((q) => q.source === 'enem_bank')).toHaveLength(4)
    expect(result.exam.questions.filter((q) => q.curriculumUnitRowIndex === 0)).toHaveLength(6)
    expect(result.exam.questions.filter((q) => q.curriculumUnitRowIndex === 1)).toHaveLength(6)
    expect(result.exam.metadata.curriculumPlanVersionId).toBe(113)
    const generated = mocks.generate.mock.calls[0][0]
    expect(generated.questionCount).toBe(8)
    expect(generated.slots).toHaveLength(8)
    expect(generated.slots.every((slot: { targetEnemSkill?: { code: string } }) => slot.targetEnemSkill?.code === 'C2:H5')).toBe(true)
    expect(result.exam.questions.filter((q) => q.source === 'enem_bank').every((q) => q.plannedEnemSkill?.code === 'C2:H5' && q.planningAlignment?.status === 'aligned')).toBe(true)
  })
  it('não completa uma cota ENEM insuficiente com IA ou outra habilidade', async () => {
    mocks.select.mockResolvedValue({ assignments: [], warnings: ['Faltam questões compatíveis.'] })
    await expect(generateExamCore(request, 1)).rejects.toThrow('não cobrem posições compatíveis')
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
