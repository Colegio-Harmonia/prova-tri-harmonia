import type { ExamQuestion } from '@/lib/gemini/examSchema'
import type { AssembledQuestion, PipelineContext, TruthObject } from './types'

/** Rubrica padrão de descritiva calculável quando a IA não devolve critérios próprios. */
export const CALCULABLE_GRADING_CRITERIA =
  '1) Identifica os dados do problema e a estratégia de resolução adequada (30%). 2) Desenvolve os cálculos de forma organizada e sem erros (40%). 3) Apresenta a resposta final correta, com unidade ou representação adequada (30%).'

/**
 * Resposta esperada de descritiva calculável. O enunciado costuma ter vários
 * itens; o recálculo por código cobre só a grandeza do domínio. Por isso a
 * resposta-modelo escrita pela IA (já conferida contra o recálculo no runner)
 * é mantida e a conferência por código vai anexada. Sem resposta-modelo, o
 * gabarito fica só com a resolução recalculada.
 */
function calculableExpectedAnswer(truth: TruthObject, modelAnswer?: string | null): string | null {
  const answer = truth.derivedAnswer?.trim()
  if (!answer) return modelAnswer?.trim() || null
  const derivation = truth.derivation?.trim().replace(/[.;]\s*$/, '')
  const prose = modelAnswer?.trim()
  if (prose) return `${prose}\n\nConferência do cálculo (recalculada por código): ${derivation ? `${derivation}. ` : ''}Resultado: ${answer}.`
  return derivation ? `Resolução: ${derivation}. Resposta final: ${answer}.` : `Resposta final: ${answer}.`
}

/** Estágio 6 — monta o `ExamQuestion` final apenas quando a cadeia passou. */
export function assembleExamQuestion(ctx: PipelineContext, assembled: AssembledQuestion): ExamQuestion {
  const { plan, truth, alternatives, correctLetter, visualPlan, statement, supportText, metadata } = assembled
  const isObjective = ctx.questionType === 'objetiva'
  const calculable = plan.truthStrategy === 'calculavel'
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
    expectedAnswer: isObjective
      ? null
      : calculable
        ? (calculableExpectedAnswer(truth, assembled.expectedAnswer) ?? truth.claim ?? null)
        : (assembled.expectedAnswer?.trim() || truth.derivedAnswer || truth.claim || null),
    gradingCriteria: isObjective
      ? null
      : (assembled.gradingCriteria?.trim() || (calculable ? CALCULABLE_GRADING_CRITERIA : 'Critérios definidos na revisão docente.')),
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
