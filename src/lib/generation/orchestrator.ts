import { assembleAlternatives, defaultShuffle, gateDistractors, gateInterpretiveSupport, gateStatement, gateStrategy, gateTruth } from './gates'
import { recordGateRejection, recordStageAttempt, recordStageFailure } from './metrics'
import { QuestionPipelineError, StageGateError } from './types'
import type { AssembledQuestion, PipelineContext, PipelineOptions, StageId, StageRunners } from './types'

const DEFAULT_MAX_ATTEMPTS = 3

async function runStage<T>(
  stage: StageId,
  ctx: PipelineContext,
  fn: (attempt: number) => Promise<T>,
  options: PipelineOptions,
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttemptsPerStage ?? DEFAULT_MAX_ATTEMPTS)
  let lastReason = 'falha desconhecida'
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    recordStageAttempt(stage, ctx.subject)
    try {
      return await fn(attempt)
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error)
      if (error instanceof StageGateError) {
        recordGateRejection(error.stage, error.gate, ctx.subject, error.message)
      } else {
        recordStageFailure(stage, ctx.subject, lastReason)
      }
    }
  }
  throw new QuestionPipelineError(stage, `Estágio ${stage} falhou após ${maxAttempts} tentativa(s): ${lastReason}`)
}

/**
 * Pipeline fragmentado por questão. Cada estágio tem uma responsabilidade, um
 * gate determinístico em código entre eles e retry cirúrgico: um gate que
 * falha reexecuta SÓ o estágio correspondente, reaproveitando os anteriores
 * (imutáveis). Uma falha definitiva isola apenas esta questão.
 */
export async function runStagedQuestionPipeline(
  ctx: PipelineContext,
  runners: StageRunners,
  options: PipelineOptions = {},
): Promise<{ question: AssembledQuestion; issues: Array<{ severity: 'bloqueante' | 'alerta'; reason: string }> }> {
  const shuffle = options.shuffle ?? defaultShuffle

  const plan = await runStage('stage0', ctx, async (attempt) => {
    const candidate = await runners.classifyStrategy(ctx, attempt)
    gateStrategy(ctx, candidate)
    return candidate
  }, options)

  const truth = await runStage('stage1', ctx, async (attempt) => {
    const candidate = await runners.generateTruth(ctx, plan, attempt)
    gateTruth(ctx, plan, candidate)
    return candidate
  }, options)

  let alternatives: Array<{ letter: string; text: string }> | null = null
  let correctLetter: string | null = null
  const correctAnswerText = truth.derivedAnswer ?? truth.claim ?? ''

  if (ctx.questionType === 'objetiva') {
    const distractors = await runStage('stage2', ctx, async (attempt) => {
      const candidate = await runners.generateDistractors(ctx, plan, truth, attempt)
      gateDistractors(plan, truth, candidate, correctAnswerText)
      gateInterpretiveSupport(plan, truth, candidate)
      return candidate
    }, options)
    const assembledAlternatives = assembleAlternatives(distractors, correctAnswerText, shuffle)
    alternatives = assembledAlternatives.alternatives
    correctLetter = assembledAlternatives.correctLetter
  }

  const statement = await runStage('stage3', ctx, async (attempt) => {
    const candidate = await runners.writeStatement(ctx, plan, truth, alternatives ?? [], attempt)
    gateStatement(ctx, plan, truth, candidate)
    return candidate
  }, options)

  const metadata = await runStage('stage4', ctx, async (attempt) =>
    runners.generateMetadata(ctx, truth, statement, alternatives ?? [], correctLetter, attempt), options)

  const assembled: AssembledQuestion = {
    plan,
    truth,
    alternatives,
    correctLetter,
    statement: statement.statement,
    supportText: statement.supportText,
    metadata,
  }

  const issues = await runStage('stage5', ctx, async (attempt) => runners.audit(ctx, assembled, attempt), options)
  const blocking = issues.filter((issue) => issue.severity === 'bloqueante')
  if (blocking.length) {
    recordGateRejection('stage5', 'audit', ctx.subject, blocking.map((issue) => issue.reason).join(' '), plan.domain)
    throw new QuestionPipelineError('stage5', `A auditoria final bloqueou a questão: ${blocking.map((issue) => issue.reason).join(' ')}`)
  }

  return { question: assembled, issues }
}
