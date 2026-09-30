import { evaluateWithJev, type JevAnswers, type JevDecisionResult } from './jevClient'

export type ActivityPedagogicalIntent = 'formativa' | 'recuperacao'

export type ActivityGenerationStrategy = {
  approach: 'retomada_guiada' | 'pratica_espacada' | 'aplicacao_contextualizada'
  progression: 'passo_a_passo' | 'gradual' | 'desafio_progressivo'
  support: 'exemplo_modelado' | 'pistas_graduais' | 'autonomia_assistida'
  evidence: 'verificacao_direta' | 'transferencia_proxima' | 'explicacao_do_raciocinio'
}

export type ActivityGenerationDecision = {
  strategy: ActivityGenerationStrategy
  source: JevDecisionResult['source']
  needsReview: boolean
  readinessProbability: number | null
}

export type ActivityGenerationDecisionInput = {
  segment: 'anos-iniciais' | 'anos-finais' | 'ensino-medio'
  gradeYear: number
  subject: string
  pedagogicalIntent: ActivityPedagogicalIntent
  questionCount: number
  selectedSkills: Array<{ code: string; description: string | null; plannedQuestions: number | null }>
  units: Array<{ title: string; objectives: string[]; bnccCodes: string[] }>
}

const QUESTION_VERSION = '2026-09-30.v1'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const READY_THRESHOLD = 0.7

const choice = <T extends string>(answers: JevAnswers, id: string, allowed: readonly T[], fallback: T): T => {
  const answer = answers[id]
  return answer?.type === 'choice' && allowed.includes(answer.choice as T) ? answer.choice as T : fallback
}

export function strategyFromActivityJevAnswers(answers: JevAnswers): ActivityGenerationStrategy {
  return {
    approach: choice(answers, 'approach', ['retomada_guiada', 'pratica_espacada', 'aplicacao_contextualizada'] as const, 'retomada_guiada'),
    progression: choice(answers, 'progression', ['passo_a_passo', 'gradual', 'desafio_progressivo'] as const, 'gradual'),
    support: choice(answers, 'support', ['exemplo_modelado', 'pistas_graduais', 'autonomia_assistida'] as const, 'pistas_graduais'),
    evidence: choice(answers, 'evidence', ['verificacao_direta', 'transferencia_proxima', 'explicacao_do_raciocinio'] as const, 'verificacao_direta'),
  }
}

export function routeActivityGenerationDecision(answers: JevAnswers) {
  const ready = answers.ready
  const probability = ready?.type === 'noul' ? ready.noul : 0
  return probability >= READY_THRESHOLD
    ? { route: 'automatic' as const, outcome: 'activity_strategy_selected' }
    : { route: 'review' as const, outcome: 'activity_strategy_requires_review' }
}

export function activityGenerationStrategyInstruction(strategy: ActivityGenerationStrategy, skillCodes: string[]) {
  const approach = {
    retomada_guiada: 'retome o conceito essencial antes de exigir aplicação',
    pratica_espacada: 'distribua oportunidades curtas de prática sem repetição mecânica',
    aplicacao_contextualizada: 'reconstrua a habilidade em situações próximas e significativas',
  }[strategy.approach]
  const progression = {
    passo_a_passo: 'organize a sequência em passos explícitos',
    gradual: 'avance do reconhecimento para a aplicação com dificuldade gradual',
    desafio_progressivo: 'avance rapidamente para desafios progressivos, mantendo apoio recuperável',
  }[strategy.progression]
  const support = {
    exemplo_modelado: 'inclua contexto que permita modelar o raciocínio esperado',
    pistas_graduais: 'ofereça pistas graduais no enunciado sem revelar a resposta',
    autonomia_assistida: 'priorize autonomia, com apoio apenas quando necessário',
  }[strategy.support]
  const evidence = {
    verificacao_direta: 'verifique diretamente o componente ainda não dominado',
    transferencia_proxima: 'peça transferência para uma situação próxima à trabalhada',
    explicacao_do_raciocinio: 'inclua oportunidades de explicitar o raciocínio',
  }[strategy.evidence]
  return `Estratégia de atividade decidida pelo Jev: ${approach}; ${progression}; ${support}; ${evidence}. As habilidades ${skillCodes.join(', ')}, a quantidade de questões e a distribuição definida pelo professor são obrigatórias e não podem ser substituídas.`
}

export async function decideActivityGenerationStrategy(
  input: ActivityGenerationDecisionInput,
  options: { evaluate?: typeof evaluateWithJev } = {},
): Promise<ActivityGenerationDecision> {
  const evaluate = options.evaluate ?? evaluateWithJev
  const questions = {
    approach: {
      type: 'choice' as const,
      instructions: 'Qual abordagem é mais adequada para a atividade trabalhar as habilidades selecionadas, considerando a intenção pedagógica e a faixa etária?',
      options: {
        retomada_guiada: 'Retomar explicitamente o conceito essencial.',
        pratica_espacada: 'Consolidar por prática variada e distribuída.',
        aplicacao_contextualizada: 'Reconstruir a aprendizagem em situações próximas e significativas.',
      },
    },
    progression: {
      type: 'choice' as const,
      instructions: 'Qual progressão cognitiva deve organizar as questões sem alterar a matriz definida pelo professor?',
      options: { passo_a_passo: 'Passos explícitos.', gradual: 'Do reconhecimento à aplicação.', desafio_progressivo: 'Desafios crescentes com apoio recuperável.' },
    },
    support: {
      type: 'choice' as const,
      instructions: 'Qual forma de apoio ajuda o estudante a reconstruir a habilidade sem entregar a resposta?',
      options: { exemplo_modelado: 'Contexto que modele o raciocínio.', pistas_graduais: 'Pistas graduais.', autonomia_assistida: 'Autonomia com apoio pontual.' },
    },
    evidence: {
      type: 'choice' as const,
      instructions: 'Que evidência deve predominar para verificar a aprendizagem ao final da atividade?',
      options: { verificacao_direta: 'Verificação direta do componente-alvo.', transferencia_proxima: 'Transferência para situação próxima.', explicacao_do_raciocinio: 'Explicitação do raciocínio.' },
    },
    ready: {
      type: 'noul' as const,
      instructions: 'O recorte possui informação suficiente para escolher com segurança uma estratégia de atividade?',
      criteria: { true: 'Habilidades, objetivos e distribuição são coerentes.', false: 'O recorte é vago, contraditório ou insuficiente.' },
    },
  }
  const fallbackAnswers: JevAnswers = {
    approach: { type: 'choice', choice: 'retomada_guiada' },
    progression: { type: 'choice', choice: 'gradual' },
    support: { type: 'choice', choice: 'pistas_graduais' },
    evidence: { type: 'choice', choice: 'verificacao_direta' },
    ready: { type: 'noul', noul: 0 },
  }
  const result = await evaluate({
    operation: 'jev/activities/recovery-strategy',
    questionVersion: QUESTION_VERSION,
    state: input,
    questions,
    route: routeActivityGenerationDecision,
    fallback: { answers: fallbackAnswers, routing: { route: 'fallback', outcome: 'guided_recovery_fallback' } },
    context: {
      feature: 'activity_generation',
      segment: input.segment,
      gradeYear: input.gradeYear,
      subject: input.subject,
      pedagogicalIntent: input.pedagogicalIntent,
      skillCount: input.selectedSkills.length,
    },
    cacheTtlMs: CACHE_TTL_MS,
  })
  const ready = result.answers.ready
  return {
    strategy: strategyFromActivityJevAnswers(result.answers),
    source: result.source,
    needsReview: result.routing.route !== 'automatic',
    readinessProbability: ready?.type === 'noul' ? ready.noul : null,
  }
}
