import { describe, expect, it, vi } from 'vitest'
vi.mock('@/db/client', () => ({ db: {} }))
import { assessPlanningAlignment, assessPlanningAlignmentBatch } from './planningAlignment'
const question = { number: 1, statement: 'Qual é a ideia principal?', supportText: 'A passage about leadership.', alternatives: [{ letter: 'A', text: 'Leadership' }], correctLetter: 'A' }
const target = { subject: 'Inglês', gradeYear: 1, unitTitle: 'Leadership', curriculumContent: 'Vocabulary and theme', objectives: [], targetEnemSkill: { code: 'C2:H5', description: 'Associar vocábulos ao tema' } }

describe('conferência independente do alvo planejado', () => {
  it('envia conteúdo, alternativas, resposta e alvo ao avaliador sem inventar classificação', async () => {
    const evaluate = vi.fn().mockResolvedValue({ source: 'provider', model: 'jev', answers: Object.fromEntries(['conteudo', 'habilidade', 'turma'].map((key) => [key, { type: 'choice', choice: 'aligned' }])) })
    const assessment = await assessPlanningAlignment(question, target, evaluate)
    expect(assessment.status).toBe('aligned')
    expect(evaluate.mock.calls[0][0].state).toMatchObject({ target: { targetEnemSkill: { code: 'C2:H5' } }, question: { correctLetter: 'A', supportText: question.supportText } })
    expect(question).not.toHaveProperty('saeb')
  })
  it.each(['partial', 'misaligned'])('conserva o diagnóstico %s em qualquer dimensão', async (choice) => {
    const evaluate = vi.fn().mockResolvedValue({ source: 'provider', model: 'jev', answers: { conteudo: { type: 'choice', choice: 'aligned' }, habilidade: { type: 'choice', choice }, turma: { type: 'choice', choice: 'aligned' } } })
    expect((await assessPlanningAlignment(question, target, evaluate)).status).toBe(choice)
  })
  it('falta de resposta ou fallback nunca resulta em compatibilidade', async () => {
    expect((await assessPlanningAlignment(question, target, vi.fn().mockResolvedValue({ source: 'fallback', model: 'jev', answers: {} }))).status).toBe('unavailable')
    expect((await assessPlanningAlignment(question, target, vi.fn().mockResolvedValue({ source: 'provider', model: 'jev', answers: {} }))).status).toBe('partial')
  })
})


describe('conferência em lotes independentes', () => {
  it('preserva as três dimensões e a identidade de cada item', async () => {
    const evaluate = vi.fn().mockResolvedValue({ source: 'provider', model: 'jev', answers: Object.fromEntries([0, 1, 2].flatMap((index) => ['conteudo', 'habilidade', 'turma'].map((dimension) => [`item_${index}_${dimension}`, { type: 'choice', choice: index === 1 && dimension === 'conteudo' ? 'misaligned' : index === 2 && dimension === 'turma' ? 'partial' : 'aligned' }]))) })
    const result = await assessPlanningAlignmentBatch([question, { ...question, statement: 'Outro conteúdo' }, { ...question, statement: 'Mídia incompleta' }], target, evaluate)
    expect(result.map((assessment) => assessment.status)).toEqual(['aligned', 'misaligned', 'partial'])
    const input = evaluate.mock.calls[0][0]
    expect(Object.keys(input.questions)).toHaveLength(9)
    expect(input.state.items.item_1.statement).toBe('Outro conteúdo')
    expect(input.questions.item_0_conteudo.instructions).toContain('mesmos conhecimentos trabalhados')
    expect(input.questions.item_0_conteudo.instructions).toContain('não exija palavras iguais')
  })
  it('fallback e respostas ausentes não aprovam itens', async () => {
    const evaluate = vi.fn().mockResolvedValue({ source: 'fallback', model: 'jev', answers: {} })
    expect((await assessPlanningAlignmentBatch([question, question], target, evaluate)).map((assessment) => assessment.status)).toEqual(['unavailable', 'unavailable'])
    evaluate.mockResolvedValue({ source: 'provider', model: 'jev', answers: {} })
    expect((await assessPlanningAlignmentBatch([question], target, evaluate))[0].status).toBe('partial')
  })
})
