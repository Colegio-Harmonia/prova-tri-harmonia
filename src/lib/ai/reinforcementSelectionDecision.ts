import { evaluateWithJev, type JevAnswers, type JevDecisionResult } from './jevClient'

export type ReinforcementSelectionStrategy = {
  allocation: 'equilibrada' | 'cobertura_habilidades' | 'profundidade_banco'
  bloomProfile: 'fundamentos_aplicacao' | 'aplicacao_contextual' | 'analise_transferencia'
  yearMix: 'amplo' | 'recente_variado'
}

export type ReinforcementSelectionDecision = {
  strategy: ReinforcementSelectionStrategy
  source: JevDecisionResult['source']
  needsReview: boolean
  readinessProbability: number | null
}

export type ReinforcementSelectionDecisionInput = {
  gradeYear: number
  subject: string
  area: string
  questionCount: number
  requestedYear: number | null
  skills: Array<{
    code: string
    description: string | null
    candidateCount: number
    bloomLevels: string[]
  }>
}

const QUESTION_VERSION = '2026-09-30.v1'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const READY_THRESHOLD = 0.7

const choice = <T extends string>(answers: JevAnswers, id: string, allowed: readonly T[], fallback: T): T => {
  const answer = answers[id]
  return answer?.type === 'choice' && allowed.includes(answer.choice as T) ? answer.choice as T : fallback
}

export function strategyFromReinforcementJevAnswers(answers: JevAnswers): ReinforcementSelectionStrategy {
  return {
    allocation: choice(answers, 'allocation', ['equilibrada', 'cobertura_habilidades', 'profundidade_banco'] as const, 'equilibrada'),
    bloomProfile: choice(answers, 'bloom_profile', ['fundamentos_aplicacao', 'aplicacao_contextual', 'analise_transferencia'] as const, 'fundamentos_aplicacao'),
    yearMix: choice(answers, 'year_mix', ['amplo', 'recente_variado'] as const, 'amplo'),
  }
}

export function routeReinforcementSelectionDecision(answers: JevAnswers) {
  const ready = answers.ready
  const probability = ready?.type === 'noul' ? ready.noul : 0
  return probability >= READY_THRESHOLD
    ? { route: 'automatic' as const, outcome: 'reinforcement_strategy_selected' }
    : { route: 'review' as const, outcome: 'reinforcement_strategy_requires_review' }
}

function weightFromAvailability(
  allocation: ReinforcementSelectionStrategy['allocation'],
  candidateCount: number,
  targetPerSkill: number,
) {
  if (allocation === 'equilibrada') return 1
  if (allocation === 'cobertura_habilidades') {
    if (candidateCount > 0 && candidateCount <= targetPerSkill) return 3
    if (candidateCount > 0 && candidateCount <= targetPerSkill * 2) return 2
    return 1
  }
  if (candidateCount >= targetPerSkill * 3) return 3
  if (candidateCount >= targetPerSkill * 2) return 2
  return 1
}

export function reinforcementAllocationWeights(
  strategy: ReinforcementSelectionStrategy,
  skills: ReinforcementSelectionDecisionInput['skills'],
) {
  const targetPerSkill = Math.max(1, Math.ceil(skills.reduce((sum, skill) => sum + skill.candidateCount, 0) / Math.max(1, skills.length)))
  return Object.fromEntries(skills.map((skill) => [skill.code, weightFromAvailability(strategy.allocation, skill.candidateCount, targetPerSkill)]))
}

export async function decideReinforcementSelectionStrategy(
  input: ReinforcementSelectionDecisionInput,
  options: { evaluate?: typeof evaluateWithJev } = {},
): Promise<ReinforcementSelectionDecision> {
  const evaluate = options.evaluate ?? evaluateWithJev
  const questions = {
    allocation: {
      type: 'choice' as const,
      instructions: 'Como repartir as questões entre as habilidades selecionadas, considerando a quantidade pedida e a disponibilidade real do banco?',
      criteria: {
        equilibrada: 'Distribuir igualmente entre as habilidades.',
        cobertura_habilidades: 'Proteger a presença das habilidades com menos itens elegíveis.',
        profundidade_banco: 'Usar mais itens das habilidades com maior oferta no banco.',
      },
    },
    bloom_profile: {
      type: 'choice' as const,
      instructions: 'Qual perfil cognitivo deve orientar a ordem de preferência entre itens elegíveis do banco?',
      criteria: {
        fundamentos_aplicacao: 'Consolidar compreensão e aplicação essencial.',
        aplicacao_contextual: 'Priorizar aplicação em contextos típicos do ENEM.',
        analise_transferencia: 'Priorizar análise e transferência entre contextos.',
      },
    },
    year_mix: {
      type: 'choice' as const,
      instructions: 'Quando nenhum ano específico foi exigido, qual mistura de edições do ENEM é mais adequada?',
      criteria: { amplo: 'Variar amplamente entre os anos disponíveis.', recente_variado: 'Favorecer anos recentes sem usar um único ano.' },
    },
    ready: {
      type: 'noul' as const,
      instructions: 'Há recorte pedagógico e oferta de itens suficientes para aplicar as escolhas anteriores com segurança?',
      criteria: { true: 'Há habilidades válidas, candidatas elegíveis e oferta suficiente para a estratégia escolhida.', false: 'Faltam itens ou os dados são contraditórios/insuficientes.' },
    },
  }
  const fallbackAnswers: JevAnswers = {
    allocation: { type: 'choice', choice: 'equilibrada' },
    bloom_profile: { type: 'choice', choice: 'fundamentos_aplicacao' },
    year_mix: { type: 'choice', choice: 'amplo' },
    ready: { type: 'noul', noul: 0 },
  }
  const result = await evaluate({
    operation: 'jev/reinforcement/enem-selection',
    questionVersion: QUESTION_VERSION,
    state: input,
    questions,
    route: routeReinforcementSelectionDecision,
    fallback: { answers: fallbackAnswers, routing: { route: 'fallback', outcome: 'balanced_reinforcement_fallback' } },
    context: {
      feature: 'enem_reinforcement', gradeYear: input.gradeYear, subject: input.subject,
      area: input.area, skillCount: input.skills.length, questionCount: input.questionCount,
    },
    cacheTtlMs: CACHE_TTL_MS,
  })
  const ready = result.answers.ready
  return {
    strategy: strategyFromReinforcementJevAnswers(result.answers),
    source: result.source,
    needsReview: result.routing.route !== 'automatic',
    readinessProbability: ready?.type === 'noul' ? ready.noul : null,
  }
}
