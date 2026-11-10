import { beforeEach, describe, expect, it, vi } from 'vitest'
import { examQuestionSchema } from '@/lib/gemini/examSchema'
import type { CurriculumSelection } from '@/types/exam'
const mocks = vi.hoisted(() => ({ bloom: vi.fn(), inep: vi.fn() }))
vi.mock('./importedQuestionBloom', () => ({ classifyQuestionBloom: mocks.bloom }))
vi.mock('./questionInepClassification', () => ({ classifyQuestionsInep: mocks.inep }))
import { assembleManualExam, classifyManualQuestion, manualExamSchema } from './manualExam'
import { manualClassificationComplete, recommendCreationMode } from './creationMode'

const metadata = { segment: 'anos-iniciais' as const, gradeYear: 3, academicYear: 2026, subject: 'Filosofia', questionCount: 0, objectiveCount: 0, discursiveCount: 0, alternativesCount: 0 }
const question = examQuestionSchema.parse({ number: 1, type: 'objetiva', source: 'acervo', statement: 'Original', bloomLevel: 'compreender', bnccCodes: [], bnccStatus: 'nao_mapeado', pedagogicalClassification: { dok: { categoryCode: 'DOK_1', confidence: 0, justification: '', evidence: '' }, soloExpected: { categoryCode: 'UNIESTRUTURAL', confidence: 0, justification: '', evidence: '' } }, alternatives: [{ letter: 'A', text: 'A' }, { letter: 'B', text: 'B' }], correctLetter: 'B' })
const bloom = { status: 'classified', source: 'provider', model: 'jev', confidence: 0.9, classifiedAt: '2026-10-30' } as const
const inep = { version: 'v2', status: 'not_applicable', source: 'fallback', model: 'jev', confidence: null, matrix: null, area: null, competency: null, skill: null, approximate: false, referenceGrade: null, classifiedAt: '2026-10-30' } as const

beforeEach(() => { vi.clearAllMocks() })
describe('criação manual', () => {
  it('aceita disciplina sem BNCC ou planejamento e valida a série', () => {
    expect(manualExamSchema.safeParse(metadata).success).toBe(true)
    expect(manualExamSchema.safeParse({ ...metadata, gradeYear: 9 }).success).toBe(false)
  })
  it('recomenda manual sem habilidades e automático apenas com mapeamento em todas as disciplinas', () => {
    const data = (mapped: boolean) => ({ units: [{ habilidades: { status: mapped ? 'mapeado' : 'nao_mapeado', skills: mapped ? [{ code: 'EF03MA01' }] : [] } }] }) as CurriculumSelection
    expect(recommendCreationMode([{ data: data(true) }])).toBe('automatic')
    expect(recommendCreationMode([{ data: data(false) }])).toBe('manual')
    expect(recommendCreationMode([{}])).toBe('manual')
    expect(recommendCreationMode([{ data: data(true) }, { data: data(false) }])).toBe('manual')
  })
  it('recalcula números e contagens sem reescrever o conteúdo ou o gabarito', () => {
    const exam = assembleManualExam(metadata, [{ ...question, number: 9 }, { ...question, number: 4, type: 'descritiva', alternatives: null, correctLetter: null, expectedAnswer: 'Original' }])
    expect(exam.metadata).toMatchObject({ creationMode: 'manual', questionCount: 2, objectiveCount: 1, discursiveCount: 1 })
    expect(exam.questions.map((q) => q.number)).toEqual([1, 2])
    expect(exam.questions[0]).toMatchObject({ statement: 'Original', correctLetter: 'B', bnccCodes: [], bnccStatus: 'nao_mapeado' })
  })
  it('aciona Bloom e INEP independentemente e preserva sucesso entre as tentativas', async () => {
    mocks.bloom.mockRejectedValueOnce(new Error('temporary')).mockImplementation(async ([q]) => [{ ...q, bloomLevel: 'analisar', bloomAssessment: bloom }])
    mocks.inep.mockImplementation(async ([q]) => [{ ...q, inepAssessment: inep }])
    const result = await classifyManualQuestion(question, metadata)
    expect(mocks.bloom).toHaveBeenCalledTimes(2)
    expect(mocks.inep).toHaveBeenCalledTimes(1)
    expect(manualClassificationComplete(result)).toBe(true)
    expect(result).toMatchObject({ statement: 'Original', bloomLevel: 'analisar', inepAssessment: { status: 'not_applicable' } })
  })
  it('mantém a questão e o sucesso de Bloom quando INEP fica pendente', async () => {
    mocks.bloom.mockImplementation(async ([q]) => [{ ...q, bloomAssessment: bloom }])
    mocks.inep.mockRejectedValue(new Error('temporary'))
    const result = await classifyManualQuestion(question, metadata)
    expect(mocks.bloom).toHaveBeenCalledTimes(1)
    expect(mocks.inep).toHaveBeenCalledTimes(3)
    expect(result.bloomAssessment?.status).toBe('classified')
    expect(manualClassificationComplete(result)).toBe(false)
    expect(result.correctLetter).toBe('B')
  })
})
