import type { ExamQuestion } from '@/lib/gemini/examSchema'
import type { AssembledQuestion, PipelineContext } from './types'

/** Estágio 6 — monta o `ExamQuestion` final apenas quando a cadeia passou. */
export function assembleExamQuestion(ctx: PipelineContext, assembled: AssembledQuestion): ExamQuestion {
  const { plan, truth, alternatives, correctLetter, visualPlan, statement, supportText, metadata } = assembled
  const isObjective = ctx.questionType === 'objetiva'
  const steps = truth.derivation.split(/;\s*/).map((step) => step.trim()).filter(Boolean)
  const visualSpec = visualPlan.visualType === 'coordinate_plane'
    ? 'coordinate_plane'
    : visualPlan.visualType === 'function_graph' || visualPlan.visualType === 'statistical_chart'
      ? 'chart'
      : 'none'

  return {
    number: ctx.questionNumber,
    source: 'ia',
    type: ctx.questionType,
    bloomLevel: metadata.bloomLevel,
    statement,
    supportText,
    alternatives: isObjective ? alternatives : null,
    correctLetter: isObjective ? correctLetter : null,
    expectedAnswer: isObjective ? null : (assembled.expectedAnswer?.trim() || truth.derivedAnswer || truth.claim || null),
    gradingCriteria: isObjective ? null : (assembled.gradingCriteria?.trim() || 'Critérios definidos na revisão docente.'),
    solutionBlueprint: plan.truthStrategy === 'calculavel' && plan.domain
      ? {
          domain: plan.domain,
          variables: [],
          equations: [],
          values: truth.values,
          calculationSteps: steps.length ? steps.slice(0, 12) : [truth.derivation],
          derivedAnswer: truth.derivedAnswer ?? truth.derivation,
          visualSpec,
        }
      : null,
    bnccCodes: metadata.bnccCodes,
    bnccStatus: metadata.bnccStatus,
    bnccSummary: metadata.bnccSummary,
    pedagogicalClassification: metadata.pedagogicalClassification,
    saeb: { applicable: false, source: null, value: null, approximate: false },
    needsImage: visualPlan.required,
    imageQuery: visualPlan.required ? visualPlan.rationale : null,
    whatIfImage: visualPlan.whatIfImage ?? null,
    visualPlan: {
      decision: visualPlan.required ? 'recommended' : 'not_needed',
      required: visualPlan.required,
      purpose: visualPlan.purpose,
      visualType: visualPlan.visualType,
      renderer: null,
      parameters: visualPlan.data ?? null,
      rationale: visualPlan.rationale,
    },
    image: null,
    review: null,
  }
}
