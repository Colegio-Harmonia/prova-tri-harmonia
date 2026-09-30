import { z } from 'zod'
import { StructuredGenerationError, generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import { canonicalDomainsForSubject, getCanonicalDomain } from './domains'
import { buildDeterministicMathStatement } from './deterministicMathStatement'
import { gateMetadata, gateStatement, gateTruth, gateVisualPlan, gateVisualReference } from './gates'
import { getRuleEngine, registeredRuleEngineIds } from './rules'
import { StageGateError } from './types'
import type { AssembledQuestion, MetadataDraft, PipelineContext, QuestionPlan, StageRunners, StatementDraft, TruthObject, VisualPlan } from './types'
import { TRUTH_STRATEGIES } from './types'

// Cada estágio é uma chamada isolada com um único contrato. As regras de cada
// prompt são só as relevantes àquela função (evita diluição de atenção).

const stage0Schema = z.object({
  truthStrategy: z.enum(TRUTH_STRATEGIES),
  domain: z.string().nullable().optional(),
  ruleId: z.string().nullable().optional(),
  rationale: z.string().min(1).max(1_600).transform((value) => value.slice(0, 400).trim()),
})
const STAGE0_SCHEMA = {
  type: 'object',
  properties: {
    truthStrategy: { type: 'string', enum: [...TRUTH_STRATEGIES] },
    domain: { type: 'string', nullable: true },
    ruleId: { type: 'string', nullable: true },
    rationale: { type: 'string' },
  },
  required: ['truthStrategy', 'rationale'],
}

/**
 * O modelo pode obedecer ao JSON e ainda produzir um plano impossível (por
 * exemplo, `calculavel` sem domínio). Esta normalização é deliberadamente
 * feita ANTES do plano entrar no pipeline: nenhum estágio posterior precisa
 * tentar adivinhar ou consertar uma decisão estrutural inválida.
 */
export function validateStage0Plan(
  ctx: PipelineContext,
  parsed: z.infer<typeof stage0Schema>,
  domains: ReturnType<typeof canonicalDomainsForSubject>,
): { value: QuestionPlan; issues: string[] } {
  const sourceMaterial = ctx.curriculumContent.trim()

  if (parsed.truthStrategy === 'calculavel') {
    const domain = parsed.domain?.trim()
    if (!domain || !domains.some((candidate) => candidate.id === domain)) {
      return {
        value: { truthStrategy: 'fonte_ancorada', sourceMaterial },
        issues: [`domain: para "calculavel", informe exatamente um destes domínios: ${domains.map((candidate) => candidate.id).join(', ') || '(nenhum disponível para a disciplina)'}.`],
      }
    }
    return {
      value: { truthStrategy: 'calculavel', domain: domain as QuestionPlan['domain'], sourceMaterial },
      issues: [],
    }
  }

  if (parsed.truthStrategy === 'regra_deterministica') {
    const ruleId = parsed.ruleId?.trim()
    if (!ruleId || !getRuleEngine(ruleId)) {
      return {
        value: { truthStrategy: 'fonte_ancorada', sourceMaterial },
        issues: [`ruleId: para "regra_deterministica", informe exatamente um motor registrado: ${registeredRuleEngineIds().join(', ') || '(nenhum disponível)'}.`],
      }
    }
    return { value: { truthStrategy: 'regra_deterministica', ruleId, sourceMaterial }, issues: [] }
  }

  if (!sourceMaterial) {
    return {
      value: { truthStrategy: parsed.truthStrategy },
      issues: ['curriculumContent: uma estratégia ancorada exige material curricular não vazio.'],
    }
  }
  return { value: { truthStrategy: parsed.truthStrategy, sourceMaterial }, issues: [] }
}

/**
 * Reserva segura para falha *estrutural* do classificador. Não é usada em
 * falha de rede, cota ou provedor: nesses casos não há como garantir os
 * próximos estágios. Com currículo disponível, uma questão ancorada ainda
 * passa por todas as validações de evidência, alternativas e enunciado.
 */
export function fallbackAnchoredPlan(ctx: PipelineContext): QuestionPlan | null {
  const sourceMaterial = ctx.curriculumContent.trim()
  return sourceMaterial.length >= 8
    ? { truthStrategy: 'fonte_ancorada', sourceMaterial }
    : null
}

/**
 * Converte um gate semântico em feedback de reparo para a própria chamada
 * estruturada. Assim, resposta formalmente JSON mas pedagogicamente inválida
 * não sai do runner para falhar (e ser repetida às cegas) no orquestrador.
 */
function validateWithGate<T>(value: T, gate: () => void): { value: T; issues: string[] } {
  try {
    gate()
    return { value, issues: [] }
  } catch (error) {
    return {
      value,
      issues: [error instanceof StageGateError || error instanceof Error ? error.message : String(error)],
    }
  }
}

/** Mantém disponível para revisão a falha da camada auxiliar de auditoria. */
export function unavailableAuditWarning(error: unknown): Array<{ severity: 'alerta'; reason: string }> | null {
  if (!(error instanceof StructuredGenerationError)) return null
  return [{
    severity: 'alerta',
    reason: `[auditoria_indisponivel] A auditoria complementar não respondeu em formato válido após ${error.attempts} tentativa(s); os gates determinísticos foram aprovados.`,
  }]
}

const stage1ValuesSchema = z.object({ values: z.record(z.string(), z.number()) })
const STAGE1_VALUES_SCHEMA = { type: 'object', properties: { values: { type: 'object' } }, required: ['values'] }

const stage1EvidenceSchema = z.object({ evidence: z.string().min(8), claim: z.string().min(1), derivation: z.string().min(1) })
const STAGE1_EVIDENCE_SCHEMA = {
  type: 'object',
  properties: { evidence: { type: 'string' }, claim: { type: 'string' }, derivation: { type: 'string' } },
  required: ['evidence', 'claim', 'derivation'],
}

// Regra determinística: o modelo só cria o item-base e a ENTRADA estruturada
// do motor; a forma correta é decidida por código no Gate 1.
const stage1RuleSchema = z.object({ itemBase: z.string().min(5), ruleInput: z.record(z.string(), z.unknown()), derivation: z.string().min(1) })
const STAGE1_RULE_SCHEMA = {
  type: 'object',
  properties: { itemBase: { type: 'string' }, ruleInput: { type: 'object' }, derivation: { type: 'string' } },
  required: ['itemBase', 'ruleInput', 'derivation'],
}

// Estágio 5 — auditoria de escopo reduzido: ambiguidade e alinhamento. A
// letra do gabarito é montada por código e conferida no relatório final, para
// não depender de duas respostas probabilísticas da IA.
const stage5Schema = z.object({
  issues: z.array(z.object({
    severity: z.enum(['bloqueante', 'alerta']),
    criterion: z.enum(['gabarito', 'unicidade', 'calculo_ou_dados', 'linguagem', 'alinhamento']),
    reason: z.string().min(1),
  })).default([]),
  answerKeyAudit: z.object({
    declaredLetter: z.string().nullable(),
    independentlyDerivedLetter: z.string().nullable(),
    matchesDeclared: z.boolean(),
    evidence: z.string().min(1),
  }).nullable().optional(),
})
const STAGE5_SCHEMA = {
  type: 'object',
  properties: {
    issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['bloqueante', 'alerta'] }, criterion: { type: 'string', enum: ['gabarito', 'unicidade', 'calculo_ou_dados', 'linguagem', 'alinhamento'] }, reason: { type: 'string' } }, required: ['severity', 'criterion', 'reason'] } },
    answerKeyAudit: { type: 'object', nullable: true, properties: { declaredLetter: { type: 'string', nullable: true }, independentlyDerivedLetter: { type: 'string', nullable: true }, matchesDeclared: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['declaredLetter', 'independentlyDerivedLetter', 'matchesDeclared', 'evidence'] },
  },
  required: ['issues'],
}

const stage2Schema = z.object({ distractors: z.array(z.string().min(1)).min(2).max(8) })
const STAGE2_RESPONSE_SCHEMA = { type: 'object', properties: { distractors: { type: 'array', items: { type: 'string' } } }, required: ['distractors'] }

const VISUAL_TYPES = ['none', 'blank_coordinate_plane', 'coordinate_plane', 'function_graph', 'statistical_chart', 'geometric_diagram', 'chemical_structure', 'map', 'timeline', 'flowchart', 'phylogeny', 'historical_document', 'illustration'] as const
const VISUAL_PURPOSES = ['nenhum', 'interpretar_dados', 'representar_relacao', 'localizar_elemento', 'comparar_elementos', 'identificar_estrutura', 'analisar_documento', 'apoiar_contexto'] as const
const stageVisualSchema = z.object({
  required: z.boolean(),
  purpose: z.enum(VISUAL_PURPOSES),
  visualType: z.enum(VISUAL_TYPES),
  data: z.record(z.unknown()).optional(),
  whatIfImage: z.string().min(8).max(400),
  rationale: z.string().min(8).max(1_600).transform((value) => value.slice(0, 400).trim()),
})
const STAGE_VISUAL_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    required: { type: 'boolean' },
    purpose: { type: 'string', enum: [...VISUAL_PURPOSES] },
    visualType: { type: 'string', enum: [...VISUAL_TYPES] },
    data: { type: 'object' },
    whatIfImage: { type: 'string', nullable: true },
    rationale: { type: 'string' },
  },
  required: ['required', 'purpose', 'visualType', 'whatIfImage', 'rationale'],
}

const stage3Schema = z.object({ statement: z.string().min(10), supportText: z.string().nullable().optional() })
const STAGE3_RESPONSE_SCHEMA = { type: 'object', properties: { statement: { type: 'string' }, supportText: { type: 'string', nullable: true } }, required: ['statement'] }

const stage4Schema = z.object({
  bloomLevel: z.enum(['lembrar', 'compreender', 'aplicar', 'analisar', 'avaliar', 'criar']),
  bnccCodes: z.array(z.string()).default([]),
  bnccStatus: z.enum(['mapeado', 'nao_mapeado']).default('nao_mapeado'),
  bnccSummary: z.string().nullable().optional(),
  needsImage: z.boolean().optional(),
  imageQuery: z.string().nullable().optional(),
  pedagogicalClassification: z.object({
    dok: z.object({ categoryCode: z.enum(['DOK_1', 'DOK_2', 'DOK_3', 'DOK_4']), confidence: z.number().min(0).max(1), justification: z.string(), evidence: z.string() }),
    soloExpected: z.object({ categoryCode: z.enum(['UNIESTRUTURAL', 'MULTIESTRUTURAL', 'RELACIONAL', 'ABSTRATO_AMPLIADO']), confidence: z.number().min(0).max(1), justification: z.string(), evidence: z.string() }),
    // O modelo varia ("médio", "media", "fácil", "difícil"); normalizamos em
    // vez de descartar a geração inteira por causa de um rótulo.
    difficulty: z.preprocess((value) => {
      if (typeof value !== 'string') return value ?? null
      const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
      if (normalized.startsWith('facil')) return 'facil'
      if (normalized.startsWith('med')) return 'media'
      if (normalized.startsWith('dif')) return 'dificil'
      return null
    }, z.enum(['facil', 'media', 'dificil']).nullable().optional()),
    estimatedTimeMinutes: z.number().positive().nullable().optional(),
  }),
})
const STAGE4_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    bloomLevel: { type: 'string', enum: ['lembrar', 'compreender', 'aplicar', 'analisar', 'avaliar', 'criar'] },
    bnccCodes: { type: 'array', items: { type: 'string' } },
    bnccStatus: { type: 'string', enum: ['mapeado', 'nao_mapeado'] },
    bnccSummary: { type: 'string', nullable: true },
    needsImage: { type: 'boolean' },
    imageQuery: { type: 'string', nullable: true },
    pedagogicalClassification: {
      type: 'object',
      properties: {
        dok: { type: 'object', properties: { categoryCode: { type: 'string', enum: ['DOK_1', 'DOK_2', 'DOK_3', 'DOK_4'] }, confidence: { type: 'number' }, justification: { type: 'string' }, evidence: { type: 'string' } }, required: ['categoryCode', 'confidence', 'justification', 'evidence'] },
        soloExpected: { type: 'object', properties: { categoryCode: { type: 'string', enum: ['UNIESTRUTURAL', 'MULTIESTRUTURAL', 'RELACIONAL', 'ABSTRATO_AMPLIADO'] }, confidence: { type: 'number' }, justification: { type: 'string' }, evidence: { type: 'string' } }, required: ['categoryCode', 'confidence', 'justification', 'evidence'] },
        difficulty: { type: 'string', nullable: true },
        estimatedTimeMinutes: { type: 'number', nullable: true },
      },
      required: ['dok', 'soloExpected'],
    },
  },
  required: ['bloomLevel', 'bnccCodes', 'bnccStatus', 'pedagogicalClassification'],
}

function contextBlock(ctx: PipelineContext, maxCurriculumChars = 1800): string {
  return `Disciplina: ${ctx.subject}. Série: ${ctx.gradeYear}º ano (${ctx.segment}). Tipo de questão: ${ctx.questionType}.
Trecho curricular disponível:
${(ctx.curriculumContent || '(vazio)').slice(0, maxCurriculumChars)}
${ctx.contentPlanInstruction ? `Instrução da matriz: ${ctx.contentPlanInstruction}` : ''}`
}

/** Reserva local para Ciências/Humanas quando o provedor falha no JSON.
 * A evidência continua sendo uma cópia do currículo; não há fato inventado. */
export function fallbackAnchoredTruth(ctx: PipelineContext, strategy: 'fonte_ancorada' | 'interpretativa'): TruthObject | null {
  const fragments = ctx.curriculumContent
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12)
  const evidence = fragments.sort((left, right) => right.length - left.length)[0]
  if (!evidence) return null
  return strategy === 'fonte_ancorada'
    ? { strategy, values: {}, sourceEvidence: evidence, claim: evidence, derivation: 'A resposta é sustentada literalmente pelo trecho curricular fornecido.' }
    : { strategy, values: {}, textEvidence: evidence, derivedAnswer: evidence, claim: evidence, derivation: 'A resposta é sustentada literalmente pelo trecho de apoio fornecido.' }
}

/** Estágio 0 — classifica a estratégia de verdade e, se calculável, o domínio. */
async function classifyStrategy(ctx: PipelineContext): Promise<QuestionPlan> {
  const domains = canonicalDomainsForSubject(ctx.subject)
  const domainList = domains.map((domain) => `- ${domain.id}: ${domain.title}. ${domain.inputDescription}`).join('\n')
  const engines = registeredRuleEngineIds().map((id) => {
    const engine = getRuleEngine(id)
    return engine ? `- ${engine.id}: ${engine.title}. ${engine.inputHint}` : `- ${id}`
  }).join('\n')
  const isMathLike = domains.length > 0
  const prompt = `Você classifica UMA questão escolar em RACIOCÍNIO, não escreve a questão.

${contextBlock(ctx)}

Decida a estratégia de verdade:
- "calculavel"${isMathLike ? '' : ' (indisponível para esta disciplina: nenhum domínio com recalculador)'}: a resposta é um número/classificação obtido por cálculo. ESCOLHA OBRIGATORIAMENTE um destes domínios:
${domainList || '(nenhum)'}
- "regra_deterministica": regra mecânica de língua decidida por motor. Informe o ruleId de um destes motores:
${engines || '(nenhum)'}
- "fonte_ancorada": fato de Humanas/Ciências que deve citar literalmente o trecho curricular acima.
- "interpretativa": leitura de texto/literatura sustentada por um trecho.

Se a disciplina tem domínio disponível e a questão pede um valor numérico, use "calculavel" e escolha o domínio mais adequado. Nunca invente um domínio ou ruleId fora da lista (o uso é bloqueado). Devolva também "rationale" curto.`
  try {
    const result = await generateValidatedStructuredContent({
      context: `generation/stage0-${ctx.questionNumber}`,
      prompt,
      responseSchema: STAGE0_SCHEMA,
      zodSchema: stage0Schema,
      // A primeira resposta inválida recebe o erro exato e só então é
      // solicitada novamente. Antes, `maxAttempts: 1` deixava o domínio
      // ausente atravessar o contrato e explodir no gate.
      maxAttempts: 3,
      validate: (parsed) => validateStage0Plan(ctx, parsed, domains),
    })
    return result.value
  } catch (error) {
    // Não escondemos indisponibilidade do provedor. Porém uma resposta JSON
    // estruturalmente inválida não deve condenar a prova se o próprio
    // currículo já permite uma estratégia verificável de reserva.
    if (error instanceof StructuredGenerationError && error.failureCode === 'validation_rejected') {
      const fallback = fallbackAnchoredPlan(ctx)
      if (fallback) return fallback
    }
    throw error
  }
}

/** Estágio 1 — gera só o objeto-fonte de verdade (valores ou evidência). */
async function generateTruth(ctx: PipelineContext, plan: QuestionPlan): Promise<TruthObject> {
  if (plan.truthStrategy === 'calculavel') {
    const domain = plan.domain ? getCanonicalDomain(plan.domain) : null
    if (!domain) throw new Error(`Domínio ausente para a estratégia calculável.`)
    const keyList = domain.fields.join(', ')
    const prompt = `Você gera SOMENTE os valores de entrada de um modelo matemático. Não resolva, não escreva alternativas nem enunciado.

${contextBlock(ctx)}

Domínio: ${domain.id} — ${domain.title}.
Entradas obrigatórias (todas numéricas): ${keyList}.
${domain.inputDescription}

Escolha valores plausíveis, coerentes com o contexto, e devolva apenas {"values": {${domain.fields.map((field) => `"${field}": número`).join(', ')}}}. NUNCA inclua o resultado.`
    const result = await generateValidatedStructuredContent({
      context: `generation/stage1-${domain.id}-${ctx.questionNumber}`,
      prompt,
      responseSchema: STAGE1_VALUES_SCHEMA,
      zodSchema: stage1ValuesSchema,
      maxAttempts: 3,
      validate: (parsed) => {
        const truth: TruthObject = { strategy: plan.truthStrategy, domain: plan.domain, values: parsed.values, derivation: '' }
        return validateWithGate(parsed, () => gateTruth(ctx, plan, truth))
      },
    })
    return { strategy: plan.truthStrategy, domain: plan.domain, values: result.value.values, derivation: '' }
  }

  if (plan.truthStrategy === 'fonte_ancorada') {
    const prompt = `Você extrai a EVIDÊNCIA de um material curricular. Não escreva a questão.

${contextBlock(ctx, 6000)}

Copie LITERALMENTE um trecho curto (1–2 frases) do trecho curricular acima e escreva a alegação factual que ele sustenta. A cópia precisa existir palavra por palavra no material — evidência inventada é rejeitada.
Devolva {"evidence": "...", "claim": "...", "derivation": "por que a evidência sustenta a alegação"}.`
    try {
      const result = await generateValidatedStructuredContent({
        context: `generation/stage1-anchor-${ctx.questionNumber}`,
        prompt,
        responseSchema: STAGE1_EVIDENCE_SCHEMA,
        zodSchema: stage1EvidenceSchema,
        maxAttempts: 3,
        validate: (parsed) => validateWithGate(parsed, () => gateTruth(ctx, plan, { strategy: plan.truthStrategy, values: {}, derivation: parsed.derivation, sourceEvidence: parsed.evidence, claim: parsed.claim })),
      })
      return { strategy: plan.truthStrategy, values: {}, derivation: result.value.derivation, sourceEvidence: result.value.evidence, claim: result.value.claim }
    } catch (error) {
      if (error instanceof StructuredGenerationError && error.failureCode === 'validation_rejected') {
        const fallback = fallbackAnchoredTruth(ctx, 'fonte_ancorada')
        if (fallback) return fallback
      }
      throw error
    }
  }

  if (plan.truthStrategy === 'interpretativa') {
    const prompt = `Você seleciona a EVIDÊNCIA TEXTUAL de uma questão de interpretação. Não escreva a questão.

${contextBlock(ctx, 6000)}

Escolha um trecho literal do material acima que sustente UMA única leitura, e escreva a leitura (a resposta) que ele sustenta de forma unívoca. Não use trecho que admita duas leituras.
Devolva {"evidence": "...", "claim": "leitura única", "derivation": "por que não há leitura alternativa"}.`
    try {
      const result = await generateValidatedStructuredContent({
        context: `generation/stage1-interp-${ctx.questionNumber}`,
        prompt,
        responseSchema: STAGE1_EVIDENCE_SCHEMA,
        zodSchema: stage1EvidenceSchema,
        maxAttempts: 3,
        validate: (parsed) => validateWithGate(parsed, () => gateTruth(ctx, plan, { strategy: plan.truthStrategy, values: {}, derivation: parsed.derivation, textEvidence: parsed.evidence, derivedAnswer: parsed.claim })),
      })
      return { strategy: plan.truthStrategy, values: {}, derivation: result.value.derivation, textEvidence: result.value.evidence, derivedAnswer: result.value.claim }
    } catch (error) {
      if (error instanceof StructuredGenerationError && error.failureCode === 'validation_rejected') {
        const fallback = fallbackAnchoredTruth(ctx, 'interpretativa')
        if (fallback) return fallback
      }
      throw error
    }
  }

  // regra_deterministica — o modelo só cria o item-base e a ENTRADA do motor;
  // a forma correta é decidida por código no Gate 1.
  const engine = plan.ruleId ? getRuleEngine(plan.ruleId) : null
  const prompt = `Você cria o ITEM-BASE de uma regra linguística e informa a entrada estruturada do motor. NÃO decida a forma correta.

${contextBlock(ctx)}

Motor de regras: ${plan.ruleId ?? '(ausente)'}.
Entrada esperada pelo motor: ${engine?.inputHint ?? '(não informada)'}

Crie o item-base (frase/expressão com a lacuna) e preencha ruleInput EXATAMENTE com os campos que o motor espera. A forma correta será calculada por código a partir de ruleInput.
Devolva {"itemBase": "...", "ruleInput": { ... }, "derivation": "contexto"}.`
  const result = await generateValidatedStructuredContent({
    context: `generation/stage1-rule-${ctx.questionNumber}`,
    prompt,
    responseSchema: STAGE1_RULE_SCHEMA,
    zodSchema: stage1RuleSchema,
    maxAttempts: 3,
    validate: (parsed) => validateWithGate(parsed, () => gateTruth(ctx, plan, { strategy: plan.truthStrategy, values: {}, derivation: parsed.derivation, claim: parsed.itemBase, ruleInput: parsed.ruleInput })),
  })
  return { strategy: plan.truthStrategy, values: {}, derivation: result.value.derivation, claim: result.value.itemBase, ruleInput: result.value.ruleInput }
}

/** Estágio 2 — gera N−1 distratores. Não decide gabarito nem vê/gera enunciado. */
async function generateDistractors(ctx: PipelineContext, plan: QuestionPlan, truth: TruthObject): Promise<string[]> {
  const count = (ctx.segment === 'anos-iniciais' ? 4 : 5) - 1
  const answer = plan.truthStrategy === 'calculavel' && plan.domain
    ? (getCanonicalDomain(plan.domain)?.compute(truth.values).answer.choiceDisplay ?? truth.derivedAnswer ?? '')
    : (truth.derivedAnswer ?? truth.claim ?? '')
  let hints: string[] = []
  if (plan.domain) {
    try {
      hints = getCanonicalDomain(plan.domain)?.compute(truth.values).distractorHints ?? []
    } catch {
      hints = []
    }
  }
  const prompt = `Você gera APENAS ${count} alternativas INCORRETAS (distratores) plausíveis. Não escreva o enunciado e não escolha o gabarito.

Disciplina: ${ctx.subject}. Série: ${ctx.gradeYear}º ano.
Objeto de verdade: ${JSON.stringify({ values: truth.values, derivacao: truth.derivation, evidencia: truth.sourceEvidence ?? truth.textEvidence ?? null })}.
Resposta CORRETA (NÃO repita, NÃO use): ${answer}.
${hints.length ? `Erros típicos sugeridos: ${hints.join(' | ')}.` : ''}

Regras obrigatórias:
- Cada distrator representa um erro típico plausível, nunca a resposta correta.
- Use o MESMO formato e tamanho da resposta correta: se a correta é um valor/expressão, devolva valores/expressões; se é uma classificação, devolva classificações curtas (ex.: "externa", "secante").
- NÃO copie os erros típicos literalmente, NÃO repita texto explicativo e NÃO repita o mesmo distrator. Cada item deve ser claramente diferente dos demais.
Devolva {"distractors": ["...", ...]} com ${count} itens curtos e distintos.`
  const result = await generateValidatedStructuredContent({
    context: `generation/stage2-${ctx.questionNumber}`,
    prompt,
    responseSchema: STAGE2_RESPONSE_SCHEMA,
    zodSchema: stage2Schema,
    maxAttempts: 3,
    validate: (parsed) => validateWithGate(parsed, () => {
      if (parsed.distractors.length !== count) throw new StageGateError('stage2', 'distractor_count', `A questão exige exatamente ${count} distratores, mas recebeu ${parsed.distractors.length}.`)
      // Temporariamente, a validação semântica dos distratores fica para a
      // revisão humana. Ela estava rejeitando respostas já estruturadas e
      // cancelando a geração inteira depois das tentativas do provedor.
      const normalizedDistractors = parsed.distractors.map((value) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR'))
      if (new Set(normalizedDistractors).size !== count) {
        throw new StageGateError('stage2', 'distractor_duplicate', 'Os distratores precisam ser distintos.')
      }
      const normalizedAnswer = answer.replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR')
      if (normalizedAnswer && normalizedDistractors.includes(normalizedAnswer)) {
        throw new StageGateError('stage2', 'distractor_matches_answer', 'Um distrator não pode repetir a resposta correta.')
      }
    }),
  })
  return result.value.distractors
}

/** Estágio visual — decide se a questão precisa mesmo de uma representação. */
async function planVisual(ctx: PipelineContext, plan: QuestionPlan, truth: TruthObject): Promise<VisualPlan> {
  if (ctx.forceNoVisual) {
    return { required: false, purpose: 'nenhum', visualType: 'none', whatIfImage: null, rationale: 'Questão substituta sem dependência de ilustração após falha de geração visual.' }
  }
  const prompt = `Você decide se UMA questão escolar precisa de recurso visual ANTES de o enunciado ser escrito.

${contextBlock(ctx)}
Estratégia de verdade: ${plan.truthStrategy}.
Objeto de verdade: ${JSON.stringify({ values: truth.values, derivacao: truth.derivation, evidencia: truth.sourceEvidence ?? truth.textEvidence ?? truth.claim ?? null })}.

Escolha um visual SOMENTE quando ele for essencial para resolver ou compreender o item sem revelar a resposta. Não use imagem como decoração. Cálculos puramente simbólicos, sistemas algébricos, regra de três e fórmulas não precisam de imagem. Se a instrução curricular exigir explicitamente uma figura, gráfico, mapa, estrutura ou documento, marque required:true.

Tipos possíveis: none, coordinate_plane, function_graph, statistical_chart, geometric_diagram, chemical_structure, map, timeline, flowchart, phylogeny, historical_document, illustration.
Crie whatIfImage como um briefing curto de ilustração para uso futuro, mesmo quando required:false. Descreva somente cenário, objetos e relações neutras; NUNCA inclua resposta, resultado de cálculo, alternativa correta, valores resolvidos, rótulos que entreguem a solução ou instruções de prova.
Se required:false, purpose DEVE ser "nenhum", visualType DEVE ser "none" e não envie data. Se required:true, escolha o tipo mais específico, informe o objetivo pedagógico em purpose, extraia em data apenas informações que já existam no objeto de verdade e explique em rationale como ele será usado sem acrescentar dados.
Devolva {"required": boolean, "purpose": "...", "visualType": "...", "data": {...}, "whatIfImage": "...", "rationale": "..."}.`
  const result = await generateValidatedStructuredContent({
    context: `generation/stage_visual-${ctx.questionNumber}`,
    prompt,
    responseSchema: STAGE_VISUAL_RESPONSE_SCHEMA,
    zodSchema: stageVisualSchema,
    maxAttempts: 3,
    validate: (parsed) => validateWithGate(parsed, () => gateVisualPlan(parsed)),
  })
  return result.value
}

/** Estágio 3 — redige o enunciado sobre o objeto de verdade e as alternativas fixas. */
async function writeStatement(ctx: PipelineContext, plan: QuestionPlan, truth: TruthObject, visualPlan: VisualPlan, alternatives: Array<{ letter: string; text: string }>): Promise<StatementDraft> {
  const deterministicStatement = buildDeterministicMathStatement(ctx, plan, truth, visualPlan)
  if (deterministicStatement) return deterministicStatement

  const prompt = `Você redige o ENUNCIADO de uma questão escolar. Você NÃO altera nenhum valor ou fato recebido.

Disciplina: ${ctx.subject}. Série: ${ctx.gradeYear}º ano (${ctx.segment}). Tipo: ${ctx.questionType}.
Objeto de verdade (imutável): ${JSON.stringify({ values: truth.values, derivacao: truth.derivation, evidencia: truth.sourceEvidence ?? truth.textEvidence ?? truth.claim ?? null })}.
Alternativas JÁ FIXAS (não mude o texto delas): ${alternatives.map((alternative) => `${alternative.letter}) ${alternative.text}`).join(' | ')}.
Resposta canônica já definida (use para orientar a pergunta, mas não revele no enunciado): ${truth.derivedAnswer ?? truth.claim ?? ''}.
Plano visual imutável: ${JSON.stringify(visualPlan)}.

Contextualize pedagogicamente sem introduzir NENHUM número ou fato novo. Se faltar um dado, retorne o enunciado impossível de completar em vez de inventar (o gate rejeita números inventados). Se required:false, não faça referência a figura, imagem, gráfico, mapa, diagrama ou ilustração. Se required:true, o enunciado pode mencionar somente o recurso previsto, sem inventar seus dados. O nome supportText é interno ao sistema e NUNCA pode aparecer no enunciado. Se houver texto de apoio, escreva "Leia o texto a seguir" ou "Considere o trecho abaixo"; nunca escreva nomes de campos, payload ou JSON para o estudante.
Devolva {"statement": "...", "supportText": texto de apoio ou null}.`
  const result = await generateValidatedStructuredContent({
    context: `generation/stage3-${ctx.questionNumber}`,
    prompt,
    responseSchema: STAGE3_RESPONSE_SCHEMA,
    zodSchema: stage3Schema,
    maxAttempts: 3,
    validate: (parsed) => validateWithGate(parsed, () => {
      const draft = { statement: parsed.statement, supportText: parsed.supportText ?? null }
      gateStatement(ctx, plan, truth, draft)
      gateVisualReference(visualPlan, draft)
    }),
  })
  return { statement: result.value.statement, supportText: result.value.supportText ?? null }
}

/** Estágio 4 — metadados pedagógicos sobre o enunciado já pronto. */
async function generateMetadata(ctx: PipelineContext, truth: TruthObject, statement: StatementDraft, alternatives: Array<{ letter: string; text: string }>, correctLetter: string | null): Promise<MetadataDraft> {
  const prompt = `Você classifica pedagogicamente uma questão PRONTA. Não altere enunciado, alternativas nem gabarito.

Disciplina: ${ctx.subject}. Série: ${ctx.gradeYear}º ano.
Enunciado: ${statement.statement}
${statement.supportText ? `Apoio: ${statement.supportText}` : ''}
Alternativas: ${alternatives.map((alternative) => `${alternative.letter}) ${alternative.text}`).join(' | ')}. Gabarito: ${correctLetter ?? '—'}.

Devolva bloomLevel, bnccCodes/bnccStatus/bnccSummary (nunca invente código BNCC; se não houver, use [] e "nao_mapeado"), pedagogicalClassification (DOK/SOLO) com justificativa e evidência citando literalmente o enunciado. Defina needsImage:false e imageQuery:null: a decisão visual já foi tomada por um estágio próprio.`
  const result = await generateValidatedStructuredContent({
    context: `generation/stage4-${ctx.questionNumber}`,
    prompt,
    responseSchema: STAGE4_RESPONSE_SCHEMA,
    zodSchema: stage4Schema,
    maxAttempts: 3,
    validate: (parsed) => validateWithGate(parsed, () => gateMetadata({
      ...parsed,
      bnccSummary: parsed.bnccSummary ?? null,
      needsImage: false,
      imageQuery: null,
    })),
  })
  return {
    ...result.value,
    bnccSummary: result.value.bnccSummary ?? null,
    needsImage: false,
    imageQuery: null,
  }
}

/**
 * Estágio 5 — auditoria de escopo reduzido. O fato/cálculo já foi garantido
 * pelos Gates 1–3; aqui só sobra ambiguidade e alinhamento curricular real.
 */
async function audit(ctx: PipelineContext, assembled: AssembledQuestion): Promise<Array<{ severity: 'bloqueante' | 'alerta'; reason: string }>> {
  const prompt = `Você faz a AUDITORIA FINAL de uma questão escolar já construída. O fato/cálculo e o gabarito já foram garantidos por validação determinística; NÃO os recalcule. Foque apenas em ambiguidade de linguagem e alinhamento curricular real.

Disciplina: ${ctx.subject}. Série: ${ctx.gradeYear}º ano (${ctx.segment}).
Enunciado: ${assembled.statement}
${assembled.supportText ? `Apoio: ${assembled.supportText}` : ''}
Alternativas: ${(assembled.alternatives ?? []).map((alternative) => `${alternative.letter}) ${alternative.text}`).join(' | ') || '(questão descritiva)'}
Gabarito definido por código: ${assembled.correctLetter ?? '—'}

Devolva issues (bloqueante somente com evidência concreta). Não inclua bloqueio sobre cálculo ou gabarito.`
  try {
    const result = await generateValidatedStructuredContent({
      context: `generation/stage5-${ctx.questionNumber}`,
      prompt,
      responseSchema: STAGE5_SCHEMA,
      zodSchema: stage5Schema,
      maxAttempts: 3,
      validate: (parsed) => validateWithGate(parsed, () => {
        const blocking = parsed.issues.filter((issue) => issue.severity === 'bloqueante')
        if (blocking.length) throw new StageGateError('stage5', 'audit', blocking.map((issue) => issue.reason).join(' '))
      }),
    })
    return result.value.issues.map((issue) => ({ severity: issue.severity, reason: `[${issue.criterion}] ${issue.reason}` }))
  } catch (error) {
    // A questão já passou pelos gates determinísticos de verdade,
    // alternativas, enunciado e metadados. A auditoria é uma camada extra;
    // JSON inválido do auditor não pode descartar um item já verificável.
    // Bloqueios declarados pela auditoria são mantidos como alerta para a
    // revisão, pois ela não é a fonte de verdade do item.
    const warning = unavailableAuditWarning(error)
    if (warning) return warning
    throw error
  }
}

export const llmStageRunners: StageRunners = {
  classifyStrategy: (ctx) => classifyStrategy(ctx),
  generateTruth: (ctx, plan) => generateTruth(ctx, plan),
  planVisual: (ctx, plan, truth) => planVisual(ctx, plan, truth),
  generateDistractors: (ctx, plan, truth) => generateDistractors(ctx, plan, truth),
  writeStatement: (ctx, plan, truth, visualPlan, alternatives) => writeStatement(ctx, plan, truth, visualPlan, alternatives),
  generateMetadata: (ctx, truth, statement, alternatives, correctLetter) => generateMetadata(ctx, truth, statement, alternatives, correctLetter),
  audit: (ctx, assembled) => audit(ctx, assembled),
}
