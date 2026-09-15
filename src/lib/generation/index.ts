import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { assembleExamQuestion } from './finalize'
import { runStagedQuestionPipeline } from './orchestrator'
import { llmStageRunners } from './runners'
import type { PipelineContext, PipelineOptions } from './types'

export * from './types'
export * from './domains'
export { assembleExamQuestion } from './finalize'
export { llmStageRunners } from './runners'

/**
 * Pipeline fragmentado é o PADRÃO de geração. `STAGED_GENERATION_ENABLED=false`
 * funciona como kill switch: volta ao fluxo monolítico sem mudar código.
 */
export function isStagedGenerationEnabled(): boolean {
  return process.env.STAGED_GENERATION_ENABLED !== 'false'
}

/**
 * Gera uma questão pelo pipeline fragmentado (Estágios 0–6) e devolve o
 * `ExamQuestion` já montado. Lança `QuestionPipelineError` em falha definitiva
 * — o chamador isola a questão (fallback para o fluxo padrão ou revisão).
 */
export async function generateStagedQuestion(
  ctx: PipelineContext,
  options?: PipelineOptions,
): Promise<{ question: ExamQuestion; issues: Array<{ severity: 'bloqueante' | 'alerta'; reason: string }> }> {
  const { question, issues } = await runStagedQuestionPipeline(ctx, llmStageRunners, options)
  return { question: assembleExamQuestion(ctx, question), issues }
}
