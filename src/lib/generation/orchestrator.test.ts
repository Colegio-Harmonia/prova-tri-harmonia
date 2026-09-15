import { describe, expect, it, vi } from 'vitest'
import { runStagedQuestionPipeline } from './orchestrator'
import { QuestionPipelineError } from './types'
import type { MetadataDraft, PipelineContext, QuestionPlan, StageRunners, TruthObject } from './types'

const ctx: PipelineContext = {
  questionNumber: 1,
  subject: 'Matemática',
  gradeYear: 9,
  segment: 'anos-finais',
  curriculumContent: 'Capítulo: porcentagem e descontos.',
  questionType: 'objetiva',
}

const metadata: MetadataDraft = {
  bloomLevel: 'aplicar',
  bnccCodes: ['EF09MA05'],
  bnccStatus: 'mapeado',
  bnccSummary: null,
  pedagogicalClassification: {
    dok: { categoryCode: 'DOK_2', confidence: 0.9, justification: 'aplicação direta', evidence: '200 reais' },
    soloExpected: { categoryCode: 'MULTIESTRUTURAL', confidence: 0.8, justification: 'duas etapas', evidence: 'desconto' },
  },
}

const identityShuffle = <T,>(items: T[]): T[] => [...items]

function baseRunners(overrides: Partial<StageRunners> = {}): StageRunners {
  return {
    classifyStrategy: async () => ({ truthStrategy: 'calculavel', domain: 'percentage' }),
    generateTruth: async () => ({ strategy: 'calculavel', domain: 'percentage', values: { base: 200, percent: 10 }, derivation: '' }),
    generateDistractors: async () => ['10', '30', '40'],
    writeStatement: async () => ({ statement: 'Um produto de 200 reais recebeu 10% de desconto. Qual o valor do desconto?', supportText: null }),
    generateMetadata: async () => metadata,
    audit: async () => [],
    ...overrides,
  }
}

describe('orquestrador do pipeline fragmentado', () => {
  it('roda a cadeia completa e define o gabarito por código', async () => {
    const { question } = await runStagedQuestionPipeline(ctx, baseRunners(), { shuffle: identityShuffle })
    expect(question.correctLetter).toBe('A')
    expect(question.alternatives?.[0].text).toBe('20')
    expect(question.truth.answerNumeric).toBe(20)
    expect(question.plan.domain).toBe('percentage')
    expect(question.metadata.bnccCodes).toEqual(['EF09MA05'])
  })

  it('faz retry cirúrgico apenas do estágio que falhou', async () => {
    const generateTruth = vi.fn()
      .mockRejectedValueOnce(new Error('falha transitória'))
      .mockResolvedValueOnce({ strategy: 'calculavel', domain: 'percentage', values: { base: 200, percent: 10 }, derivation: '' } satisfies TruthObject)
    const classifyStrategy = vi.fn().mockResolvedValue({ truthStrategy: 'calculavel', domain: 'percentage' } satisfies QuestionPlan)
    const { question } = await runStagedQuestionPipeline(ctx, baseRunners({ generateTruth, classifyStrategy }), { shuffle: identityShuffle, maxAttemptsPerStage: 3 })
    expect(classifyStrategy).toHaveBeenCalledTimes(1)
    expect(generateTruth).toHaveBeenCalledTimes(2)
    expect(question.truth.answerNumeric).toBe(20)
  })

  it('bloqueia domínio sem recalculador após esgotar as tentativas', async () => {
    const runners = baseRunners({ classifyStrategy: async () => ({ truthStrategy: 'calculavel', domain: 'other' } as unknown as QuestionPlan) })
    await expect(runStagedQuestionPipeline(ctx, runners, { maxAttemptsPerStage: 2 })).rejects.toBeInstanceOf(QuestionPipelineError)
  })

  it('não monta a questão quando a auditoria final bloqueia', async () => {
    const runners = baseRunners({ audit: async () => [{ severity: 'bloqueante', reason: 'enunciado ambíguo' }] })
    await expect(runStagedQuestionPipeline(ctx, runners, { shuffle: identityShuffle })).rejects.toBeInstanceOf(QuestionPipelineError)
  })
})
