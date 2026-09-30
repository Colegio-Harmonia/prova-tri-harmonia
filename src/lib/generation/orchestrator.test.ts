import { describe, expect, it, vi } from 'vitest'
import { StructuredGenerationError } from '@/lib/gemini/structuredRepair'
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
    planVisual: async () => ({ required: false, purpose: 'nenhum', visualType: 'none', rationale: 'O cálculo é inteiramente textual.' }),
    generateDistractors: async () => ['10', '30', '40', '50'],
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

  it('propaga limite temporário do provedor para a fila sem repetir a questão', async () => {
    const providerFailure = new StructuredGenerationError(
      'Resposta da IA inválida após 3 tentativa(s).',
      'generation/stage0-1',
      3,
      ['Falha operacional ao chamar o provedor de IA.'],
      'rate_limited',
    )
    const classifyStrategy = vi.fn().mockRejectedValue(providerFailure)

    await expect(runStagedQuestionPipeline(ctx, baseRunners({ classifyStrategy }), { maxAttemptsPerStage: 2 })).rejects.toBe(providerFailure)
    expect(classifyStrategy).toHaveBeenCalledTimes(1)
  })

  it('decide o plano visual antes do enunciado e bloqueia referência a figura não planejada', async () => {
    const planVisual = vi.fn().mockResolvedValue({ required: false, purpose: 'nenhum', visualType: 'none', rationale: 'O item é puramente numérico.' })
    const writeStatement = vi.fn().mockResolvedValue({ statement: 'Observe a figura abaixo: um produto de 200 reais recebeu 10% de desconto.', supportText: null })
    await expect(runStagedQuestionPipeline(ctx, baseRunners({ planVisual, writeStatement }), { maxAttemptsPerStage: 1 })).rejects.toBeInstanceOf(QuestionPipelineError)
    expect(planVisual).toHaveBeenCalledBefore(writeStatement)
  })

  it('rejeita quantidade de alternativas diferente da exigida pela prova', async () => {
    const runners = baseRunners({ generateDistractors: async () => ['10', '30'] })
    await expect(runStagedQuestionPipeline(ctx, runners, { maxAttemptsPerStage: 1 })).rejects.toBeInstanceOf(QuestionPipelineError)
  })

  it('bloqueia domínio sem recalculador após esgotar as tentativas', async () => {
    const runners = baseRunners({ classifyStrategy: async () => ({ truthStrategy: 'calculavel', domain: 'other' } as unknown as QuestionPlan) })
    await expect(runStagedQuestionPipeline(ctx, runners, { maxAttemptsPerStage: 2 })).rejects.toBeInstanceOf(QuestionPipelineError)
  })

  it('não monta a questão quando a auditoria final bloqueia', async () => {
    const runners = baseRunners({ audit: async () => [{ severity: 'bloqueante', reason: 'enunciado ambíguo' }] })
    await expect(runStagedQuestionPipeline(ctx, runners, { shuffle: identityShuffle, maxAttemptsPerStage: 2 })).rejects.toBeInstanceOf(QuestionPipelineError)
  })

  it('repete somente a auditoria quando ela bloqueia transitoriamente', async () => {
    const audit = vi.fn()
      .mockResolvedValueOnce([{ severity: 'bloqueante', reason: 'sinalização transitória' }])
      .mockResolvedValueOnce([])
    await expect(runStagedQuestionPipeline(ctx, baseRunners({ audit }), { shuffle: identityShuffle, maxAttemptsPerStage: 2 })).resolves.toBeDefined()
    expect(audit).toHaveBeenCalledTimes(2)
  })
})
