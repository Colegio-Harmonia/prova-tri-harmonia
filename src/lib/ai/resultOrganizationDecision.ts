import { evaluateWithJev, type JevAnswers, type JevDecisionResult } from './jevClient'

export type ResultOrganizationScope = 'student' | 'class' | 'coordination' | 'school'
export type ResultOrganizationStrategy = {
  primaryLens: 'coverage' | 'skill_gap' | 'cognitive_demand' | 'consolidation'
  priorityOrder: 'coverage_first' | 'urgent_gap_first' | 'confidence_first' | 'balanced'
  actionFrame: 'complete_evidence' | 'reteach_then_reassess' | 'scaffold_complexity' | 'consolidate_and_transfer'
}

export type ResultOrganizationDecisionInput = {
  scope: ResultOrganizationScope
  evidence: 'none' | 'limited' | 'sufficient'
  completeness: 'complete' | 'pending'
  skills: Array<{
    code: string
    description: string | null
    status: 'intervencao' | 'desenvolvimento' | 'dominio' | 'amostra_insuficiente'
    confidence: 'baixa' | 'media' | 'alta'
  }>
  cognitiveLevels: Array<{
    framework: 'bloom' | 'dok'
    level: string
    performance: 'sem_evidencia' | 'abaixo_referencia' | 'em_desenvolvimento' | 'consolidado'
    confidence: 'baixa' | 'media' | 'alta'
  }>
  managementSignals: Array<{
    segment: string
    gradeYear: number | null
    subject: string | null
    signal: 'sem_evidencia' | 'incompleto' | 'abaixo_referencia' | 'adequado'
  }>
}

export type ResultOrganization = {
  scope: ResultOrganizationScope
  strategy: ResultOrganizationStrategy
  source: JevDecisionResult['source']
  needsReview: boolean
  heading: string
  interpretation: string
  nextAction: string
  prioritizedSkillCodes: string[]
}

const QUESTION_VERSION = '2026-09-30.v1'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const READY_THRESHOLD = 0.7

const choice = <T extends string>(answers: JevAnswers, id: string, allowed: readonly T[], fallback: T): T => {
  const answer = answers[id]
  return answer?.type === 'choice' && allowed.includes(answer.choice as T) ? answer.choice as T : fallback
}

export function strategyFromResultOrganizationAnswers(answers: JevAnswers): ResultOrganizationStrategy {
  return {
    primaryLens: choice(answers, 'primary_lens', ['coverage', 'skill_gap', 'cognitive_demand', 'consolidation'] as const, 'coverage'),
    priorityOrder: choice(answers, 'priority_order', ['coverage_first', 'urgent_gap_first', 'confidence_first', 'balanced'] as const, 'balanced'),
    actionFrame: choice(answers, 'action_frame', ['complete_evidence', 'reteach_then_reassess', 'scaffold_complexity', 'consolidate_and_transfer'] as const, 'complete_evidence'),
  }
}

export function routeResultOrganizationDecision(answers: JevAnswers) {
  const ready = answers.ready
  const probability = ready?.type === 'noul' ? ready.noul : 0
  return probability >= READY_THRESHOLD
    ? { route: 'automatic' as const, outcome: 'result_organization_selected' }
    : { route: 'review' as const, outcome: 'result_organization_requires_review' }
}

const statusWeight = { intervencao: 0, desenvolvimento: 1, dominio: 2, amostra_insuficiente: 3 } as const
const confidenceWeight = { alta: 0, media: 1, baixa: 2 } as const

export function prioritizeResultSkills(input: ResultOrganizationDecisionInput, strategy: ResultOrganizationStrategy) {
  return [...input.skills]
    .sort((left, right) => {
      if (strategy.priorityOrder === 'coverage_first') {
        const coverage = Number(left.status !== 'amostra_insuficiente') - Number(right.status !== 'amostra_insuficiente')
        if (coverage !== 0) return coverage
      }
      if (strategy.priorityOrder === 'confidence_first') {
        const confidence = confidenceWeight[left.confidence] - confidenceWeight[right.confidence]
        if (confidence !== 0) return confidence
      }
      const status = statusWeight[left.status] - statusWeight[right.status]
      return status || confidenceWeight[left.confidence] - confidenceWeight[right.confidence] || left.code.localeCompare(right.code)
    })
    .map((skill) => skill.code)
}

export function describeResultOrganization(strategy: ResultOrganizationStrategy, input: ResultOrganizationDecisionInput) {
  const heading = {
    coverage: 'Primeiro, confirme a cobertura das evidências',
    skill_gap: 'Comece pelas habilidades que pedem intervenção',
    cognitive_demand: 'Observe como o desempenho muda com a exigência cognitiva',
    consolidation: 'Consolide o que já aparece com evidência consistente',
  }[strategy.primaryLens]
  const interpretation = {
    coverage: input.completeness === 'pending' ? 'Há evidências pendentes; complete a revisão antes de comparar resultados.' : 'A cobertura permite avançar para a leitura pedagógica das habilidades.',
    skill_gap: 'Leia as habilidades na ordem de urgência e considere também a confiança da amostra.',
    cognitive_demand: 'Compare os níveis de Bloom e DOK para localizar onde a complexidade passa a exigir mais apoio.',
    consolidation: 'Use os resultados consistentes como base para ampliar a transferência para novos contextos.',
  }[strategy.primaryLens]
  const nextAction = {
    complete_evidence: 'Revise as pendências e amplie a amostra antes de definir uma intervenção.',
    reteach_then_reassess: 'Retome a habilidade prioritária e verifique novamente com itens equivalentes.',
    scaffold_complexity: 'Organize uma progressão de apoio do nível atual para a próxima exigência cognitiva.',
    consolidate_and_transfer: 'Proponha uma aplicação em novo contexto e acompanhe se o desempenho se mantém.',
  }[strategy.actionFrame]
  return { heading, interpretation, nextAction }
}

export async function decideResultOrganization(
  input: ResultOrganizationDecisionInput,
  options: { evaluate?: typeof evaluateWithJev } = {},
): Promise<ResultOrganization> {
  const evaluate = options.evaluate ?? evaluateWithJev
  const questions = {
    primary_lens: {
      type: 'choice' as const,
      instructions: 'Qual lente deve abrir a leitura pedagógica destes resultados anônimos e categóricos?',
      options: {
        coverage: 'Qualidade e suficiência das evidências.', skill_gap: 'Habilidades que pedem intervenção.',
        cognitive_demand: 'Mudança conforme a exigência cognitiva.', consolidation: 'Aprendizagens consistentes a consolidar e transferir.',
      },
    },
    priority_order: {
      type: 'choice' as const,
      instructions: 'Como ordenar as habilidades sem recalcular nem alterar os resultados?',
      options: {
        coverage_first: 'Evidência insuficiente antes da comparação.', urgent_gap_first: 'Intervenções mais urgentes primeiro.',
        confidence_first: 'Resultados com maior confiança primeiro.', balanced: 'Equilibrar urgência e confiança.',
      },
    },
    action_frame: {
      type: 'choice' as const,
      instructions: 'Qual próximo passo pedagógico é coerente com o conjunto de sinais?',
      options: {
        complete_evidence: 'Completar ou ampliar evidências.', reteach_then_reassess: 'Retomar e verificar novamente.',
        scaffold_complexity: 'Apoiar uma progressão de complexidade.', consolidate_and_transfer: 'Consolidar e aplicar em novo contexto.',
      },
    },
    ready: {
      type: 'noul' as const,
      instructions: 'Os sinais categóricos são suficientes para organizar a leitura sem inventar diagnóstico ou causalidade?',
      criteria: { true: 'Há sinais coerentes e cobertura identificável.', false: 'Os dados são ausentes, contraditórios ou insuficientes.' },
    },
  }
  const fallbackAnswers: JevAnswers = {
    primary_lens: { type: 'choice', choice: 'coverage' },
    priority_order: { type: 'choice', choice: 'balanced' },
    action_frame: { type: 'choice', choice: 'complete_evidence' },
    ready: { type: 'noul', noul: 0 },
  }
  const result = await evaluate({
    operation: 'jev/analytics/result-organization', questionVersion: QUESTION_VERSION, state: input, questions,
    route: routeResultOrganizationDecision,
    fallback: { answers: fallbackAnswers, routing: { route: 'fallback', outcome: 'deterministic_result_organization_fallback' } },
    context: { feature: 'result_organization', scope: input.scope, skillCount: input.skills.length, evidence: input.evidence },
    cacheTtlMs: CACHE_TTL_MS,
  })
  const strategy = strategyFromResultOrganizationAnswers(result.answers)
  return {
    scope: input.scope, strategy, source: result.source, needsReview: result.routing.route !== 'automatic',
    ...describeResultOrganization(strategy, input),
    prioritizedSkillCodes: prioritizeResultSkills(input, strategy),
  }
}
