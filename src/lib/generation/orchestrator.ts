import { assembleAlternatives, defaultShuffle, gateAlternativePresentation, gateAlternativeShape, gateDistractors, gateInterpretiveSupport, gateMetadata, gateStatement, gateStrategy, gateTruth, gateVisualPlan, gateVisualReference } from './gates'
import { getCanonicalDomain } from './domains'
import { StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import { AiBudgetExceededError } from '@/lib/ai/operationBudget'
import { recordGateRejection, recordStageAttempt, recordStageFailure } from './metrics'
import { QuestionPipelineError, StageGateError } from './types'
import type { AssembledQuestion, PipelineContext, PipelineOptions, StageId, StageRunners } from './types'

const DEFAULT_MAX_ATTEMPTS = 2

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
      // A cota é condição temporária da fila, não falha da questão. Preservar
      // a classe permite ao worker adiar o job sem gastar uma tentativa.
      if (error instanceof AiBudgetExceededError) throw error
      // Uma recusa/indisponibilidade do provedor também é temporária. Não
      // reexecute o estágio nem transforme isso em uma nova candidata: a
      // fila precisa receber a causa original para adiar o job corretamente.
      if (error instanceof StructuredGenerationError && error.failureCode !== 'validation_rejected') throw error
      lastReason = error instanceof Error ? error.message : String(error)
      if (error instanceof StageGateError) {
        recordGateRejection(error.stage, error.gate, ctx.subject, error.message)
      } else {
        recordStageFailure(stage, ctx.subject, lastReason)
      }
      // O runner já fez a rodada de reparo orientada pelo erro semântico. Um
      // novo chamado idêntico do mesmo estágio não traz informação nova e só
      // consome tentativas; a recuperação deve subir para a substituição da
      // questão, onde há novo contexto e estratégia de reserva.
      if (error instanceof StructuredGenerationError && error.failureCode === 'validation_rejected') break
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

  const visualPlan = await runStage('stage_visual', ctx, async (attempt) => {
    const candidate = await runners.planVisual(ctx, plan, truth, attempt)
    gateVisualPlan(candidate)
    return candidate
  }, options)

  let alternatives: Array<{ letter: string; text: string }> | null = null
  let correctLetter: string | null = null
  const correctAnswerText = plan.truthStrategy === 'calculavel' && plan.domain
    ? (getCanonicalDomain(plan.domain)?.compute(truth.values).answer.choiceDisplay ?? truth.derivedAnswer ?? '')
    : (truth.derivedAnswer ?? truth.claim ?? '')

  if (ctx.questionType === 'objetiva') {
    gateAlternativePresentation(correctAnswerText)
    const distractors = await runStage('stage2', ctx, async (attempt) => {
      const candidate = await runners.generateDistractors(ctx, plan, truth, attempt)
      const expectedDistractorCount = (ctx.segment === 'anos-iniciais' ? 4 : 5) - 1
      if (candidate.length !== expectedDistractorCount) {
        throw new StageGateError('stage2', 'distractor_count', `A questão exige exatamente ${expectedDistractorCount} distratores, mas recebeu ${candidate.length}.`)
      }
      gateDistractors(plan, truth, candidate, correctAnswerText)
      gateAlternativeShape(correctAnswerText, candidate)
      gateInterpretiveSupport(plan, truth, candidate)
      return candidate
    }, options)
    const assembledAlternatives = assembleAlternatives(distractors, correctAnswerText, shuffle)
    alternatives = assembledAlternatives.alternatives
    correctLetter = assembledAlternatives.correctLetter
  }

  const statement = await runStage('stage3', ctx, async (attempt) => {
    const candidate = await runners.writeStatement(ctx, plan, truth, visualPlan, alternatives ?? [], attempt)
    gateStatement(ctx, plan, truth, candidate)
    gateVisualReference(visualPlan, candidate)
    return candidate
  }, options)

  const metadata = await runStage('stage4', ctx, async (attempt) => {
    const candidate = await runners.generateMetadata(ctx, truth, statement, alternatives ?? [], correctLetter, attempt)
    gateMetadata(candidate)
    return candidate
  }, options)

  const assembled: AssembledQuestion = {
    plan,
    truth,
    alternatives,
    correctLetter,
    visualPlan,
    statement: statement.statement,
    supportText: statement.supportText,
    metadata,
  }

  const issues = await runStage('stage5', ctx, async (attempt) => {
    const candidate = await runners.audit(ctx, assembled, attempt)
    const blocking = candidate.filter((issue) => issue.severity === 'bloqueante')
    if (blocking.length) {
      throw new StageGateError('stage5', 'audit', blocking.map((issue) => issue.reason).join(' '))
    }
    return candidate
  }, options)

  return { question: assembled, issues }
}
