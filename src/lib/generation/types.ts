import type { CanonicalDomainId } from './domains'

/** Estratégias de verdade. Toda questão é classificada antes de nascer. */
export const TRUTH_STRATEGIES = ['calculavel', 'regra_deterministica', 'fonte_ancorada', 'interpretativa'] as const
export type TruthStrategy = (typeof TRUTH_STRATEGIES)[number]

export const STAGE_IDS = ['stage0', 'stage1', 'stage_visual', 'stage2', 'stage3', 'stage4', 'stage5'] as const
export type StageId = (typeof STAGE_IDS)[number]

/** Falha de um gate determinístico — sempre aponta o estágio que deve ser reexecutado. */
export class StageGateError extends Error {
  constructor(
    public readonly stage: StageId,
    public readonly gate: string,
    message: string,
  ) {
    super(message)
    this.name = 'StageGateError'
  }
}

/** Falha definitiva após esgotar as tentativas de um estágio. A questão é isolada. */
export class QuestionPipelineError extends Error {
  constructor(public readonly stage: StageId, message: string) {
    super(message)
    this.name = 'QuestionPipelineError'
  }
}

export type PipelineContext = {
  questionNumber: number
  subject: string
  gradeYear: number
  segment: string
  /** Trecho/currículo do capítulo, usado pela ancoragem factual. */
  curriculumContent: string
  /** Instrução da matriz (capítulo/tipo/recurso visual), quando houver. */
  contentPlanInstruction?: string
  /** Recuperação: a questão substituta não pode depender de imagem. */
  forceNoVisual?: boolean
  questionType: 'objetiva' | 'descritiva'
}

export type QuestionPlan = {
  truthStrategy: TruthStrategy
  domain?: CanonicalDomainId
  /** Obrigatório para `regra_deterministica`: identifica o motor de regras. */
  ruleId?: string
  /** Obrigatório para `fonte_ancorada`/`interpretativa`: material onde a evidência deve existir. */
  sourceMaterial?: string
}

export type TruthObject = {
  strategy: TruthStrategy
  domain?: CanonicalDomainId
  /** Valores de entrada (calculável) — nunca o resultado. */
  values: Record<string, number>
  /** Resposta canônica exibível (calculável). */
  derivedAnswer?: string
  answerNumeric?: number
  derivation: string
  /** Citação literal do material curricular (fonte_ancorada). */
  sourceEvidence?: string
  /** Trecho de apoio que sustenta uma leitura única (interpretativa). */
  textEvidence?: string
  /** Alegação factual que a evidência sustenta. */
  claim?: string
  /** Entrada estruturada do motor de regras (regra_deterministica). */
  ruleInput?: Record<string, unknown>
}

export type StatementDraft = {
  statement: string
  supportText: string | null
}

/** Decisão visual feita antes de o enunciado nascer. Os dados concretos são
 * completados pelo roteador de ilustrações depois que a questão é montada. */
export type VisualPlan = {
  required: boolean
  purpose: 'nenhum' | 'interpretar_dados' | 'representar_relacao' | 'localizar_elemento' | 'comparar_elementos' | 'identificar_estrutura' | 'analisar_documento' | 'apoiar_contexto'
  visualType: 'none' | 'blank_coordinate_plane' | 'coordinate_plane' | 'function_graph' | 'statistical_chart' | 'geometric_diagram' | 'chemical_structure' | 'map' | 'timeline' | 'flowchart' | 'phylogeny' | 'historical_document' | 'illustration'
  /** Dados estritamente extraídos da fonte de verdade; o roteador os valida novamente. */
  data?: Record<string, unknown>
  /** Briefing de ilustração seguro, sem resposta ou dados resolvidos. */
  whatIfImage?: string | null
  rationale: string
}

export type MetadataDraft = {
  bloomLevel: 'lembrar' | 'compreender' | 'aplicar' | 'analisar' | 'avaliar' | 'criar'
  bnccCodes: string[]
  bnccStatus: 'mapeado' | 'nao_mapeado'
  bnccSummary: string | null
  pedagogicalClassification: {
    dok: { categoryCode: 'DOK_1' | 'DOK_2' | 'DOK_3' | 'DOK_4'; confidence: number; justification: string; evidence: string }
    soloExpected: { categoryCode: 'UNIESTRUTURAL' | 'MULTIESTRUTURAL' | 'RELACIONAL' | 'ABSTRATO_AMPLIADO'; confidence: number; justification: string; evidence: string }
    difficulty?: 'facil' | 'media' | 'dificil' | null
    estimatedTimeMinutes?: number | null
  }
  /** Legado de recurso visual; a decisão oficial é feita em `visualPlan`. */
  needsImage?: boolean
  imageQuery?: string | null
}

export type AssembledQuestion = {
  plan: QuestionPlan
  truth: TruthObject
  alternatives: Array<{ letter: string; text: string }> | null
  correctLetter: string | null
  visualPlan: VisualPlan
  statement: string
  supportText: string | null
  /** Descritivas: resposta-modelo e critérios escritos pela IA. */
  expectedAnswer?: string | null
  gradingCriteria?: string | null
  metadata: MetadataDraft
}

/** Runners injetáveis: tornam o orquestrador testável sem rede. */
export type StageRunners = {
  classifyStrategy: (ctx: PipelineContext, attempt: number) => Promise<QuestionPlan>
  generateTruth: (ctx: PipelineContext, plan: QuestionPlan, attempt: number) => Promise<TruthObject>
  planVisual: (ctx: PipelineContext, plan: QuestionPlan, truth: TruthObject, attempt: number) => Promise<VisualPlan>
  generateDistractors: (ctx: PipelineContext, plan: QuestionPlan, truth: TruthObject, attempt: number) => Promise<string[]>
  writeStatement: (ctx: PipelineContext, plan: QuestionPlan, truth: TruthObject, visualPlan: VisualPlan, alternatives: Array<{ letter: string; text: string }>, attempt: number) => Promise<StatementDraft>
  generateMetadata: (ctx: PipelineContext, truth: TruthObject, statement: StatementDraft, alternatives: Array<{ letter: string; text: string }>, correctLetter: string | null, attempt: number) => Promise<MetadataDraft>
  /** Auditoria final (Estágio 5). Retorna problemas bloqueantes/alerta. */
  audit: (ctx: PipelineContext, question: AssembledQuestion, attempt: number) => Promise<Array<{ severity: 'bloqueante' | 'alerta'; reason: string }>>
}

export type PipelineOptions = {
  maxAttemptsPerStage?: number
  /** Injeção de aleatoriedade do embaralhamento (testes determinísticos). */
  shuffle?: <T>(items: T[]) => T[]
}
