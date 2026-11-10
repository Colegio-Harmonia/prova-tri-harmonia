import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ bloom: vi.fn(), inep: vi.fn() }))
vi.mock('./importedQuestionBloom', () => ({ classifyQuestionBloom: mocks.bloom }))
vi.mock('./questionInepClassification', () => ({ classifyQuestionsInep: mocks.inep }))
import { classifyExamQuestions } from './questionClassification'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
beforeEach(() => vi.clearAllMocks())
describe('classificação final da questão', () => {
  it('classifica IA e acervo, preservando o ENEM e a ordem original', async () => {
    const questions = ['ia', 'acervo', 'enem_bank'].map((source, index) => ({ source, number: index + 1, statement: 'Versão final corrigida.' })) as ExamQuestion[]
    const pending = questions.filter((q) => q.source !== 'enem_bank')
    const classified = pending.map((q) => ({ ...q, bloomLevel: 'analisar' as const, bloomAssessment: { status: 'classified' }, inepAssessment: { status: 'classified' } }))
    const context = { subject: 'História', gradeYear: 2, segment: 'ensino-medio' }
    mocks.bloom.mockResolvedValue(classified)
    mocks.inep.mockImplementation(async (items) => items)
    expect(await classifyExamQuestions(questions, context)).toEqual([...classified, questions[2]])
    expect(mocks.bloom).toHaveBeenCalledWith(pending, context)
    expect(mocks.inep).toHaveBeenCalledWith(classified, context)
  })
})

it('não consulta o JEV em prova composta somente por questões ENEM', async () => {
  const questions = [{ number: 1, source: 'enem_bank', bloomLevel: 'analisar', saeb: { applicable: true, source: 'enem', value: 'H4', approximate: false } }] as ExamQuestion[]
  expect(await classifyExamQuestions(questions, { subject: 'História', gradeYear: 2, segment: 'ensino-medio' })).toBe(questions)
  expect(mocks.bloom).not.toHaveBeenCalled()
  expect(mocks.inep).not.toHaveBeenCalled()
})


it('repete falhas e entrega somente classificações completas', async () => {
  const question = { number: 1, source: 'acervo' } as ExamQuestion
  mocks.bloom.mockImplementation(async (questions) => questions)
  mocks.inep.mockResolvedValueOnce([{ ...question, bloomAssessment: { status: 'unavailable' }, inepAssessment: { status: 'unavailable' } }])
    .mockResolvedValueOnce([{ ...question, bloomAssessment: { status: 'classified' }, inepAssessment: { status: 'classified' } }])
  const [result] = await classifyExamQuestions([question], { subject: 'Física', gradeYear: 2, segment: 'ensino-medio' })
  expect(result?.inepAssessment?.status).toBe('classified')
  expect(mocks.inep).toHaveBeenCalledTimes(2)
})

it('não salva como concluída uma classificação indisponível após três tentativas', async () => {
  const question = { number: 1, source: 'acervo' } as ExamQuestion
  mocks.bloom.mockImplementation(async (questions) => questions)
  mocks.inep.mockImplementation(async (questions) => questions)
  await expect(classifyExamQuestions([question], { subject: 'Física', gradeYear: 2, segment: 'ensino-medio' })).rejects.toThrow('após três tentativas')
  expect(mocks.inep).toHaveBeenCalledTimes(3)
})
