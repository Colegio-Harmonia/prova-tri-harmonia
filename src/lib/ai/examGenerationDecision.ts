import { evaluateWithJev, type JevAnswers, type JevDecisionResult } from './jevClient'

export type ExamGenerationStrategy = {
  cognitiveEmphasis: 'fundamentos' | 'equilibrada' | 'transferencia'
  contextualization: 'direta' | 'mista' | 'autentica'
  difficultyProfile: 'acessivel' | 'equilibrado' | 'desafiador'
  visualSupport: 'contido' | 'equilibrado' | 'intensivo'
}

export type ExamGenerationDecision = {
  strategy: ExamGenerationStrategy
  source: JevDecisionResult['source']
  needsReview: boolean
  readinessProbability: number | null
}

export type ExamGenerationDecisionInput = {
  segment: 'anos-iniciais' | 'anos-finais' | 'ensino-medio'
  gradeYear: number
  subject: string
  assessmentKind: string
  objectiveCount: number
  discursiveCount: number
  units: Array<{
    title: string
    content: string | null
    objectives: string[]
    bnccCodes: string[]
    plannedQuestions: number
    priority: 'alta' | 'media' | 'baixa'
    visualAid: 'auto' | 'obrigatorio' | 'sem_imagem'
  }>
}

export const DEFAULT_EXAM_GENERATION_STRATEGY: ExamGenerationStrategy = {
  cognitiveEmphasis: 'equilibrada',
  contextualization: 'mista',
  difficultyProfile: 'equilibrado',
  visualSupport: 'equilibrado',
}

const QUESTION_VERSION = '2026-09-30.v1'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const READY_THRESHOLD = 0.7

const choice = <T extends string>(answers: JevAnswers, id: string, allowed: readonly T[], fallback: T): T => {
  const answer = answers[id]
  return answer?.type === 'choice' && allowed.includes(answer.choice as T) ? answer.choice as T : fallback
}

export function strategyFromJevAnswers(answers: JevAnswers): ExamGenerationStrategy {
  return {
    cognitiveEmphasis: choice(answers, 'cognitive_emphasis', ['fundamentos', 'equilibrada', 'transferencia'] as const, 'equilibrada'),
    contextualization: choice(answers, 'contextualization', ['direta', 'mista', 'autentica'] as const, 'mista'),
    difficultyProfile: choice(answers, 'difficulty_profile', ['acessivel', 'equilibrado', 'desafiador'] as const, 'equilibrado'),
    visualSupport: choice(answers, 'visual_support', ['contido', 'equilibrado', 'intensivo'] as const, 'equilibrado'),
  }
}

export function routeExamGenerationDecision(answers: JevAnswers) {
  const ready = answers.ready
  const probability = ready?.type === 'noul' ? ready.noul : 0
  return probability >= READY_THRESHOLD
    ? { route: 'automatic' as const, outcome: 'exam_strategy_selected' }
    : { route: 'review' as const, outcome: 'exam_strategy_needs_review' }
}

export function examGenerationStrategyInstruction(strategy: ExamGenerationStrategy) {
  const cognitive = {
    fundamentos: 'priorize compreensão essencial e pré-requisitos, sem reduzir a fidelidade ao currículo',
    equilibrada: 'equilibre compreensão, aplicação e transferência',
    transferencia: 'priorize aplicação e transferência para situações novas, mantendo base curricular explícita',
  }[strategy.cognitiveEmphasis]
  const context = {
    direta: 'use enunciados diretos e contexto apenas quando necessário',
    mista: 'combine itens diretos com situações contextualizadas',
    autentica: 'prefira situações autênticas e significativas para a faixa etária',
  }[strategy.contextualization]
  const difficulty = {
    acessivel: 'perfil de dificuldade acessível, com progressão gradual e poucas questões difíceis',
    equilibrado: 'perfil de dificuldade equilibrado, aproximadamente 30% fácil, 50% médio e 20% difícil',
    desafiador: 'perfil mais desafiador, sem cobrar conteúdo fora do planejamento',
  }[strategy.difficultyProfile]
  const visual = {
    contido: 'recursos visuais somente quando indispensáveis ao conteúdo',
    equilibrado: 'recursos visuais quando melhorarem a compreensão ou forem exigidos pela matriz',
    intensivo: 'use apoio visual com maior frequência quando pedagogicamente pertinente e permitido pela matriz',
  }[strategy.visualSupport]
  return `Estratégia pedagógica decidida pelo Jev: ${cognitive}; ${context}; ${difficulty}; ${visual}. A matriz, os capítulos, os tipos de questão e as exigências visuais escolhidos pelo professor continuam obrigatórios.`
}

export async function decideExamGenerationStrategy(
  input: ExamGenerationDecisionInput,
  options: { evaluate?: typeof evaluateWithJev } = {},
): Promise<ExamGenerationDecision> {
  const evaluate = options.evaluate ?? evaluateWithJev
  const questions = {
    cognitive_emphasis: {
      type: 'choice' as const,
      instructions: 'Qual ênfase cognitiva é mais adequada para esta avaliação, considerando série, disciplina, objetivos, habilidades e distribuição definida pelo professor?',
      options: {
        fundamentos: 'Consolidar compreensão essencial e pré-requisitos.',
        equilibrada: 'Equilibrar compreensão, aplicação e transferência.',
        transferencia: 'Priorizar aplicação e transferência para situações novas.',
      },
    },
    contextualization: {
      type: 'choice' as const,
      instructions: 'Qual grau de contextualização é mais adequado para os conteúdos e a faixa etária?',
      options: { direta: 'Predominantemente direta.', mista: 'Combinação de direta e contextualizada.', autentica: 'Predominantemente situações autênticas.' },
    },
    difficulty_profile: {
      type: 'choice' as const,
      instructions: 'Qual perfil global de dificuldade melhor mede os objetivos informados sem extrapolar o planejamento?',
      options: { acessivel: 'Progressão acessível.', equilibrado: 'Distribuição equilibrada.', desafiador: 'Maior demanda de transferência.' },
    },
    visual_support: {
      type: 'choice' as const,
      instructions: 'Qual intensidade de apoio visual é pedagogicamente adequada, respeitando as escolhas explícitas do professor em cada capítulo?',
      options: { contido: 'Somente quando indispensável.', equilibrado: 'Quando acrescentar compreensão.', intensivo: 'Com maior frequência quando pertinente.' },
    },
    ready: {
      type: 'noul' as const,
      instructions: 'O recorte possui informação pedagógica suficiente para aplicar com segurança as quatro escolhas anteriores?',
      criteria: { true: 'Há conteúdos, objetivos ou habilidades coerentes e distribuição suficiente.', false: 'O recorte é vago, contraditório ou insuficiente para uma decisão confiável.' },
    },
  }
  const fallbackAnswers: JevAnswers = {
    cognitive_emphasis: { type: 'choice', choice: 'equilibrada' },
    contextualization: { type: 'choice', choice: 'mista' },
    difficulty_profile: { type: 'choice', choice: 'equilibrado' },
    visual_support: { type: 'choice', choice: 'equilibrado' },
    ready: { type: 'noul', noul: 0 },
  }
  const result = await evaluate({
    operation: 'jev/exams/generation-strategy',
    questionVersion: QUESTION_VERSION,
    state: input,
    questions,
    route: routeExamGenerationDecision,
    fallback: { answers: fallbackAnswers, routing: { route: 'fallback', outcome: 'balanced_strategy_fallback' } },
    context: { feature: 'exam_generation', segment: input.segment, gradeYear: input.gradeYear, subject: input.subject, unitCount: input.units.length },
    cacheTtlMs: CACHE_TTL_MS,
  })
  const ready = result.answers.ready
  return {
    strategy: strategyFromJevAnswers(result.answers),
    source: result.source,
    needsReview: result.routing.route !== 'automatic',
    readinessProbability: ready?.type === 'noul' ? ready.noul : null,
  }
}
