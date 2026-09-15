import type { ExamQuestion } from '@/lib/gemini/examSchema'
import type { AssembledQuestion, PipelineContext } from './types'

/** Estágio 6 — monta o `ExamQuestion` final apenas quando a cadeia passou. */
export function assembleExamQuestion(ctx: PipelineContext, assembled: AssembledQuestion): ExamQuestion {
  const { plan, truth, alternatives, correctLetter, statement, supportText, metadata } = assembled
  const isObjective = ctx.questionType === 'objetiva'
  const steps = truth.derivation.split(/;\s*/).map((step) => step.trim()).filter(Boolean)

  return {
    number: ctx.questionNumber,
    source: 'ia',
    type: ctx.questionType,
    bloomLevel: metadata.bloomLevel,
    statement,
    supportText,
    alternatives: isObjective ? alternatives : null,
    correctLetter: isObjective ? correctLetter : null,
    expectedAnswer: isObjective ? null : (truth.derivedAnswer ?? truth.claim ?? null),
    gradingCriteria: isObjective ? null : 'Critérios definidos na revisão docente.',
    solutionBlueprint: plan.truthStrategy === 'calculavel' && plan.domain
      ? {
          domain: plan.domain,
          variables: [],
          equations: [],
          values: truth.values,
          calculationSteps: steps.length ? steps.slice(0, 12) : [truth.derivation],
          derivedAnswer: truth.derivedAnswer ?? truth.derivation,
          visualSpec: 'none',
        }
      : null,
    bnccCodes: metadata.bnccCodes,
    bnccStatus: metadata.bnccStatus,
    bnccSummary: metadata.bnccSummary,
    pedagogicalClassification: metadata.pedagogicalClassification,
    saeb: { applicable: false, source: null, value: null, approximate: false },
    needsImage: metadata.needsImage ?? false,
    imageQuery: metadata.imageQuery ?? null,
    image: null,
    review: null,
  }
}
