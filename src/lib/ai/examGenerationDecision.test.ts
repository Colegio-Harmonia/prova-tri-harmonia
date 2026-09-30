import { describe, expect, it, vi } from 'vitest'
import { decideExamGenerationStrategy, examGenerationStrategyInstruction, routeExamGenerationDecision, strategyFromJevAnswers } from './examGenerationDecision'
import { evaluateWithJev } from './jevClient'

describe('examGenerationDecision', () => {
  it('normaliza escolhas inválidas para a estratégia equilibrada', () => {
    expect(strategyFromJevAnswers({ cognitive_emphasis: { type: 'choice', choice: 'inventada' } })).toEqual({
      cognitiveEmphasis: 'equilibrada', contextualization: 'mista', difficultyProfile: 'equilibrado', visualSupport: 'equilibrado',
    })
  })

  it('manda baixa prontidão para revisão', () => {
    expect(routeExamGenerationDecision({ ready: { type: 'noul', noul: 0.69 } }).route).toBe('review')
    expect(routeExamGenerationDecision({ ready: { type: 'noul', noul: 0.7 } }).route).toBe('automatic')
  })

  it('usa a decisão tipada e produz orientação sem alterar a matriz', async () => {
    const evaluate = vi.fn(async (options: Parameters<typeof evaluateWithJev>[0]) => ({
      model: 'jev-test', source: 'provider' as const, routing: options.route({
        cognitive_emphasis: { type: 'choice', choice: 'transferencia' }, contextualization: { type: 'choice', choice: 'autentica' },
        difficulty_profile: { type: 'choice', choice: 'desafiador' }, visual_support: { type: 'choice', choice: 'contido' }, ready: { type: 'noul', noul: 0.91 },
      }), answers: {
        cognitive_emphasis: { type: 'choice' as const, choice: 'transferencia' }, contextualization: { type: 'choice' as const, choice: 'autentica' },
        difficulty_profile: { type: 'choice' as const, choice: 'desafiador' }, visual_support: { type: 'choice' as const, choice: 'contido' }, ready: { type: 'noul' as const, noul: 0.91 },
      }, stateHash: 'hash', cacheKey: 'cache',
    }))
    const result = await decideExamGenerationStrategy({ segment: 'anos-finais', gradeYear: 8, subject: 'Ciências', assessmentKind: 'padrao', objectiveCount: 7, discursiveCount: 3, units: [{ title: 'Ecossistemas', content: 'Cadeias alimentares', objectives: ['Analisar relações'], bnccCodes: ['EF08CI01'], plannedQuestions: 10, priority: 'alta', visualAid: 'auto' }] }, { evaluate })
    expect(result).toMatchObject({ source: 'provider', needsReview: false, strategy: { cognitiveEmphasis: 'transferencia', contextualization: 'autentica', difficultyProfile: 'desafiador', visualSupport: 'contido' } })
    expect(examGenerationStrategyInstruction(result.strategy)).toContain('matriz, os capítulos, os tipos de questão e as exigências visuais')
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ operation: 'jev/exams/generation-strategy', questionVersion: '2026-09-30.v1' }))
  })
})
