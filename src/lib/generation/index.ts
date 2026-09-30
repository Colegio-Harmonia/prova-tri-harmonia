import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { assembleExamQuestion } from './finalize'
import { runStagedQuestionPipeline } from './orchestrator'
import { llmStageRunners } from './runners'
import type { PipelineContext, PipelineOptions } from './types'

export * from './types'
export * from './domains'
export * from './similarity'
export * from './alternatives'
export * from './coherence'
export { assembleExamQuestion } from './finalize'
export { llmStageRunners } from './runners'
export { generateUnifiedQuestion, type UnifiedGenerationResult } from './unifiedRunner'
export { generateExamBlueprint, type BlueprintSlot, type BlueprintParams } from './blueprint'
export { runLocalQualityGate, type LocalGateResult, type LocalGateIssue } from './localQualityGate'

/** A aplicação usa exclusivamente a geração unificada. */
export function isUnifiedGenerationEnabled(): boolean {
  return true
}

/**
 * Compatibilidade temporária para registros antigos. Nenhuma entrada atual
 * deve depender deste sinal; a geração nova usa somente o fluxo unificado.
 */
export function isStagedGenerationEnabled(): boolean {
  return false
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
