import { z } from 'zod'
import { generateValidatedStructuredContent, StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { canonicalDomainsForSubject, getCanonicalDomain, computeCanonicalDomain, comparableNumber } from './domains'
import { buildDeterministicMathStatement } from './deterministicMathStatement'
import { getRuleEngine, registeredRuleEngineIds } from './rules'
import { defaultShuffle, assembleAlternatives, gateAlternativePresentation, gateDistractors, gateInterpretiveSupport, gateMetadata, gateStatement, gateStrategy, gateTruth, gateVisualPlan, gateVisualReference } from './gates'
import { detectAlternativeAmbiguities } from './alternatives'
import { assembleExamQuestion } from './finalize'
import { runLocalQualityGate } from './localQualityGate'
import { unavailableAuditWarning } from './runners'
import { recordUnifiedAttempt, recordUnifiedSuccess, recordUnifiedRejection, recordAuditSkipped, recordAuditTriggered } from './metrics'
import { StageGateError } from './types'
import type { AssembledQuestion, MetadataDraft, PipelineContext, QuestionPlan, TruthObject, VisualPlan } from './types'
import { TRUTH_STRATEGIES } from './types'
import type { BlueprintSlot } from './blueprint'

// ---------------------------------------------------------------------------
// Schema unificado de saída (1 chamada IA por questão)
// ---------------------------------------------------------------------------

const VISUAL_TYPES = ['none', 'blank_coordinate_plane', 'coordinate_plane', 'function_graph', 'statistical_chart', 'geometric_diagram', 'chemical_structure', 'map', 'timeline', 'flowchart', 'phylogeny', 'historical_document', 'illustration'] as const
const VISUAL_PURPOSES = ['nenhum', 'interpretar_dados', 'representar_relacao', 'localizar_elemento', 'comparar_elementos', 'identificar_estrutura', 'analisar_documento', 'apoiar_contexto'] as const

const unifiedSchema = z.object({
  // Fonte de verdade (valores para calculável, evidência para ancorada)
  // Em estratégias não numéricas o modelo pode devolver metadados auxiliares
  // aqui. Eles são ignorados; para "calculavel" somente números são levados
  // ao motor determinístico, que continua rejeitando entradas incompletas.
  values: z.record(z.string(), z.unknown()).optional(),
  sourceEvidence: z.string().optional(),
  claim: z.string().optional(),
  derivation: z.string().min(1),
  ruleInput: z.record(z.string(), z.unknown()).optional(),

  // Questão completa
  supportText: z.string().nullable(),
  statement: z.string().min(20),

  // Visual
  visualPlan: z.object({
    required: z.boolean(),
    purpose: z.enum(VISUAL_PURPOSES),
    visualType: z.enum(VISUAL_TYPES),
    rationale: z.string().min(1).max(400),
    whatIfImage: z.string().nullable(),
    data: z.record(z.unknown()).optional(),
  }),

  // Distratores (para objetiva)
  distractors: z.array(z.string().min(1)).optional(),

  // Metadados pedagógicos
  bloomLevel: z.enum(['lembrar', 'compreender', 'aplicar', 'analisar', 'avaliar', 'criar']),
  bnccCodes: z.array(z.string()).default([]),
  bnccStatus: z.enum(['mapeado', 'nao_mapeado']).default('nao_mapeado'),
  bnccSummary: z.string().nullable().optional(),
  dok: z.object({
    categoryCode: z.enum(['DOK_1', 'DOK_2', 'DOK_3', 'DOK_4']),
    confidence: z.number().min(0).max(1),
    justification: z.string(),
    evidence: z.string(),
  }),
  soloExpected: z.object({
    categoryCode: z.enum(['UNIESTRUTURAL', 'MULTIESTRUTURAL', 'RELACIONAL', 'ABSTRATO_AMPLIADO']),
    confidence: z.number().min(0).max(1),
    justification: z.string(),
    evidence: z.string(),
  }),
  difficulty: z.preprocess((value) => {
    if (typeof value !== 'string') return value ?? null
    const normalized = value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    if (normalized.startsWith('facil')) return 'facil'
    if (normalized.startsWith('med')) return 'media'
    if (normalized.startsWith('dif')) return 'dificil'
    return null
  }, z.enum(['facil', 'media', 'dificil']).nullable().optional()),
  estimatedTimeMinutes: z.number().positive().nullable().optional(),

  // Self-confidence para decidir se auditoria é necessária
  selfConfidence: z.number().min(0).max(1),
})

const UNIFIED_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    values: { type: 'object' },
    sourceEvidence: { type: 'string' },
    claim: { type: 'string' },
    derivation: { type: 'string' },
    ruleInput: { type: 'object' },
    supportText: { type: 'string', nullable: true },
    statement: { type: 'string' },
    visualPlan: {
      type: 'object',
      properties: {
        required: { type: 'boolean' },
        purpose: { type: 'string', enum: [...VISUAL_PURPOSES] },
        visualType: { type: 'string', enum: [...VISUAL_TYPES] },
        rationale: { type: 'string' },
        whatIfImage: { type: 'string', nullable: true },
        data: { type: 'object' },
      },
      required: ['required', 'purpose', 'visualType', 'rationale', 'whatIfImage'],
    },
    distractors: { type: 'array', items: { type: 'string' } },
    bloomLevel: { type: 'string', enum: ['lembrar', 'compreender', 'aplicar', 'analisar', 'avaliar', 'criar'] },
    bnccCodes: { type: 'array', items: { type: 'string' } },
    bnccStatus: { type: 'string', enum: ['mapeado', 'nao_mapeado'] },
    bnccSummary: { type: 'string', nullable: true },
    dok: {
      type: 'object',
      properties: {
        categoryCode: { type: 'string', enum: ['DOK_1', 'DOK_2', 'DOK_3', 'DOK_4'] },
        confidence: { type: 'number' },
        justification: { type: 'string' },
        evidence: { type: 'string' },
      },
      required: ['categoryCode', 'confidence', 'justification', 'evidence'],
    },
    soloExpected: {
      type: 'object',
      properties: {
        categoryCode: { type: 'string', enum: ['UNIESTRUTURAL', 'MULTIESTRUTURAL', 'RELACIONAL', 'ABSTRATO_AMPLIADO'] },
        confidence: { type: 'number' },
        justification: { type: 'string' },
        evidence: { type: 'string' },
      },
      required: ['categoryCode', 'confidence', 'justification', 'evidence'],
    },
    difficulty: { type: 'string', nullable: true },
    estimatedTimeMinutes: { type: 'number', nullable: true },
    selfConfidence: { type: 'number' },
  },
  required: ['derivation', 'supportText', 'statement', 'visualPlan', 'bloomLevel', 'dok', 'soloExpected', 'selfConfidence'],
}

const distractorRepairSchema = z.object({
  distractors: z.array(z.string().min(1)),
})

const DISTRACTOR_REPAIR_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    distractors: { type: 'array', items: { type: 'string' } },
  },
  required: ['distractors'],
}

// ---------------------------------------------------------------------------
// Auditoria IA seletiva (stage5 do pipeline antigo, agora condicional)
// ---------------------------------------------------------------------------

const AUDIT_CONFIDENCE_THRESHOLD = 0.7
const AUDIT_SAMPLE_RATE = 0.15

function shouldAudit(slot: BlueprintSlot, selfConfidence: number): boolean {
  // Questões com fonte determinística (cálculo/regra) têm gabarito já
  // conferido por código — só a amostragem justifica gastar IA.
  if (slot.truthStrategy === 'calculavel' || slot.truthStrategy === 'regra_deterministica') {
    return Math.random() < AUDIT_SAMPLE_RATE
  }
  // Questões interpretativas/ancoradas sempre passam por auditoria
  // quando a confiança é baixa.
  if (selfConfidence < AUDIT_CONFIDENCE_THRESHOLD) return true
  // Caso contrário, amostragem.
  return Math.random() < AUDIT_SAMPLE_RATE
}

const auditSchema = z.object({
  issues: z.array(z.object({
    severity: z.enum(['bloqueante', 'alerta']),
    criterion: z.enum(['gabarito', 'unicidade', 'calculo_ou_dados', 'linguagem', 'alinhamento']),
    reason: z.string().min(1),
  })).default([]),
})

const AUDIT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['bloqueante', 'alerta'] },
          criterion: { type: 'string', enum: ['gabarito', 'unicidade', 'calculo_ou_dados', 'linguagem', 'alinhamento'] },
          reason: { type: 'string' },
        },
        required: ['severity', 'criterion', 'reason'],
      },
    },
  },
  required: ['issues'],
}

async function runSelectiveAudit(
  ctx: PipelineContext,
  assembled: AssembledQuestion,
): Promise<Array<{ severity: 'bloqueante' | 'alerta'; reason: string }>> {
  const prompt = `Você faz a AUDITORIA FINAL de uma questão escolar já construída. O fato/cálculo e o gabarito já foram garantidos por validação determinística; NÃO os recalcule. Foque apenas em ambiguidade de linguagem e alinhamento curricular real.

Disciplina: ${ctx.subject}. Série: ${ctx.gradeYear}º ano (${ctx.segment}).
Enunciado: ${assembled.statement}
${assembled.supportText ? `Apoio: ${assembled.supportText}` : ''}
Alternativas: ${(assembled.alternatives ?? []).map(a => `${a.letter}) ${a.text}`).join(' | ') || '(questão descritiva)'}
Gabarito definido por código: ${assembled.correctLetter ?? '—'}

Devolva issues (bloqueante somente com evidência concreta). Não inclua bloqueio sobre cálculo ou gabarito.`

  try {
    const result = await generateValidatedStructuredContent({
      context: `generation/unified-audit-${ctx.questionNumber}`,
      prompt,
      responseSchema: AUDIT_RESPONSE_SCHEMA,
      zodSchema: auditSchema,
      maxAttempts: 2,
    })
    return result.value.issues.map(i => ({ severity: i.severity, reason: `[${i.criterion}] ${i.reason}` }))
  } catch (error) {
    const warning = unavailableAuditWarning(error)
    if (warning) return warning
    throw error
  }
}

// ---------------------------------------------------------------------------
// Geração unificada (1 chamada IA por questão)
// ---------------------------------------------------------------------------

function buildUnifiedPrompt(ctx: PipelineContext, slot: BlueprintSlot, forcedEvidence?: string): string {
  const domains = canonicalDomainsForSubject(ctx.subject)
  const domain = slot.domain ? getCanonicalDomain(slot.domain) : null
  const engine = slot.ruleId ? getRuleEngine(slot.ruleId) : null

  let strategyInstructions = ''

  if (slot.truthStrategy === 'calculavel' && domain) {
    const keyList = domain.fields.join(', ')
    strategyInstructions = `ESTRATÉGIA: CALCULÁVEL.
Domínio: ${domain.id} — ${domain.title}.
Entradas obrigatórias em "values" (todas numéricas): ${keyList}.
${domain.inputDescription}
Escolha valores plausíveis e devolva em "values". NÃO calcule o resultado — ele será recalculado por código.
NÃO invente números no enunciado que não estejam nos values.`
  } else if (slot.truthStrategy === 'regra_deterministica' && engine) {
    strategyInstructions = `ESTRATÉGIA: REGRA DETERMINÍSTICA.
Motor de regras: ${engine.id} — ${engine.title}.
Entrada esperada em "ruleInput": ${engine.inputHint}
Preencha ruleInput EXATAMENTE com os campos que o motor espera. A forma correta será calculada por CÓDIGO a partir de ruleInput. NÃO decida a resposta gramatical.
PROIBIÇÃO: NÃO varie o tempo verbal dos distratores se a regra avalia apenas concordância.`
  } else if (slot.truthStrategy === 'fonte_ancorada') {
    strategyInstructions = `ESTRATÉGIA: FONTE ANCORADA.
Copie LITERALMENTE um trecho curto (1–2 frases) do currículo abaixo em "sourceEvidence".
Escreva a alegação factual em "claim". A cópia PRECISA existir palavra por palavra no material.`
  } else {
    strategyInstructions = `ESTRATÉGIA: INTERPRETATIVA.
Selecione um trecho literal do material que sustente UMA única leitura em "sourceEvidence".
Escreva a leitura (resposta) em "claim". Não use trecho que admita duas leituras.`
  }

  const distCount = ctx.questionType === 'objetiva'
    ? (ctx.segment === 'anos-iniciais' ? 3 : 4)
    : 0

  const visualInstructions = slot.needsVisual
    ? 'O blueprint exige recurso visual. Escolha o tipo mais específico, informe purpose e extraia em data apenas dados do objeto de verdade.'
    : 'NÃO use recurso visual. Defina required:false, purpose:"nenhum", visualType:"none". Não faça referência a figura, imagem, gráfico, mapa ou diagrama no enunciado.'

  return `Você é um especialista em avaliação educacional e elaboração de itens.

Gere UMA questão completa com TODOS os campos em uma única resposta JSON.

Disciplina: ${ctx.subject}. Série: ${ctx.gradeYear}º ano (${ctx.segment}). Tipo: ${ctx.questionType}.
Dificuldade alvo: ${slot.difficulty}. Ângulo temático: ${slot.coreTopic}.

Trecho curricular disponível:
${ctx.curriculumContent.slice(0, 3000)}

REGRA DE FONTE TEXTUAL (OBRIGATÓRIA): só mencione texto, trecho, artigo, poema, capítulo ou “material didático” se o campo "supportText" trouxer integralmente a fonte que o estudante precisa ler. Esse campo deve conter um texto/dado autocontido, nunca apenas título, número de capítulo, lista de tópicos ou resumo inventado. Os tópicos curriculares acima não são um texto de leitura. Se não houver fonte textual suficiente, formule uma questão autocontida e não faça referência a leitura, capítulo ou material externo.

${strategyInstructions}
${forcedEvidence ? `
EVIDÊNCIA LITERAL OBRIGATÓRIA:
Use EXATAMENTE este trecho em "sourceEvidence": ${JSON.stringify(forcedEvidence)}
Não o parafraseie, não o complete e não cite outro trecho. Reescreva enunciado, apoio e alegação somente para que sejam sustentados por essa evidência.` : ''}

${ctx.contentPlanInstruction ? `Instrução adicional: ${ctx.contentPlanInstruction}` : ''}

${ctx.questionType === 'objetiva' ? `Gere exatamente ${distCount} distratores em "distractors". Cada distrator deve representar um erro típico plausível, NUNCA a resposta correta. Use o MESMO formato/tamanho da resposta. NÃO repita distratores.` : 'Questão descritiva: não gere distratores.'}

${visualInstructions}

Preencha também: bloomLevel, bnccCodes/bnccStatus (nunca invente código BNCC), dok, soloExpected com justificativa citando literalmente o enunciado.

Defina selfConfidence (0–1) indicando o quão confiante você está na qualidade e unicidade da questão.`
}

/**
 * Um erro puramente local nas alternativas não deve invalidar enunciado,
 * gabarito e metadados que já passaram pelos demais gates. Este reparo usa
 * uma resposta pequena e volta pelo mesmo gate determinístico antes de ser
 * aceito; se não resolver, o fluxo normal ainda regenera a questão inteira.
 */
async function repairDistractorsLocally(params: {
  ctx: PipelineContext
  slot: BlueprintSlot
  plan: QuestionPlan
  truth: TruthObject
  statement: string
  supportText: string | null
  bnccCodes: string[]
  correctAnswerText: string
  distractors: string[]
  failure: StageGateError
}): Promise<{ distractors: string[]; warnings: string[] }> {
  const expectedCount = params.distractors.length
  const prompt = `Você corrige SOMENTE os distratores de uma questão objetiva escolar.

CONTEXTO
Disciplina: ${params.ctx.subject}. Série: ${params.ctx.gradeYear}º ano (${params.ctx.segment}).
BNCC: ${params.bnccCodes.join(', ') || 'não mapeada'}.
Estratégia de verdade: ${params.slot.truthStrategy}.
Material curricular: ${params.ctx.curriculumContent.slice(0, 3000)}

QUESTÃO APROVADA
Enunciado: ${params.statement}
${params.supportText ? `Texto de apoio: ${params.supportText}` : ''}
Resposta correta (NÃO incluir nem alterar): ${params.correctAnswerText}
Distratores atuais: ${JSON.stringify(params.distractors)}

DIAGNÓSTICO DETERMINÍSTICO
Código: ${params.failure.gate}
Erro: ${params.failure.message}

DEVOLVA APENAS JSON: {"distractors":[...]}
- Gere exatamente ${expectedCount} distratores novos.
- Eles precisam ser todos distintos mesmo ignorando acentos, maiúsculas e espaços.
- Nenhum pode reproduzir, equivaler ou conter a resposta correta.
- Preserve o tema, o nível e o formato das respostas. Não altere enunciado, texto de apoio, BNCC ou gabarito.`

  const generated = await generateValidatedStructuredContent({
    context: `generation/unified-distractor-repair-${params.ctx.questionNumber}`,
    prompt,
    responseSchema: DISTRACTOR_REPAIR_RESPONSE_SCHEMA,
    zodSchema: distractorRepairSchema,
    maxAttempts: 2,
    validate: (candidate) => {
      if (candidate.distractors.length !== expectedCount) {
        return {
          value: candidate,
          issues: [`Esperados ${expectedCount} distratores, recebidos ${candidate.distractors.length}.`],
          repairInstructions: [{ code: 'DISTRACTOR_COUNT', fields: ['distractors'], message: `Devolva exatamente ${expectedCount} distratores.` }],
        }
      }
      try {
        gateDistractors(params.plan, params.truth, candidate.distractors, params.correctAnswerText)
        gateInterpretiveSupport(params.plan, params.truth, candidate.distractors)
        return { value: candidate, issues: [] }
      } catch (error) {
        if (!(error instanceof StageGateError)) throw error
        return {
          value: candidate,
          issues: [`[${error.gate}] ${error.message}`],
          repairInstructions: [{
            code: error.gate === 'distractor_duplicate' ? 'DUPLICATE_ALTERNATIVE' : 'DISTRACTOR_INVALID',
            fields: ['distractors'],
            message: error.message,
            protectedFields: ['statement', 'supportText', 'correctAnswerText', 'bnccCodes'],
          }],
        }
      }
    },
  })

  return {
    distractors: generated.value.distractors,
    warnings: generated.warnings,
  }
}

export type UnifiedGenerationResult = {
  question: ExamQuestion
  issues: Array<{ severity: 'bloqueante' | 'alerta'; reason: string }>
  needsAudit: boolean
}

function isUnavailableDeterministicRule(error: StructuredGenerationError): boolean {
  return error.failureCode === 'validation_rejected'
    && error.issues.some((issue) => /regra de ortografia .*n[aã]o implementada|sem motor de regras|n[aã]o h[aá] motor de regras/i.test(issue))
}

function isEvidenceValidationFailure(error: StructuredGenerationError): boolean {
  return error.failureCode === 'validation_rejected'
    && error.issues.some((issue) => /evidencia .*nao existe|evidencia .*vazia|evidence_(not_found|missing)/i.test(issue))
}

function literalEvidenceFallback(curriculumContent: string): string | null {
  const fragments = curriculumContent
    .split(/(?<=[.!?])\s+|\n+/)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length >= 12)
  return fragments.sort((left, right) => right.length - left.length)[0] ?? null
}

export async function generateUnifiedQuestion(
  ctx: PipelineContext,
  slot: BlueprintSlot,
  options?: { shuffle?: <T>(items: T[]) => T[]; forcedEvidence?: string },
): Promise<UnifiedGenerationResult> {
  const startMs = Date.now()
  const shuffle = options?.shuffle ?? defaultShuffle
  recordUnifiedAttempt(ctx.subject, slot.truthStrategy)

  const prompt = buildUnifiedPrompt(ctx, slot, options?.forcedEvidence)

  let result: Awaited<ReturnType<typeof generateValidatedStructuredContent<typeof unifiedSchema._output>>>
  try {
    result = await generateValidatedStructuredContent({
      context: `generation/unified-${ctx.questionNumber}`,
      prompt,
      responseSchema: UNIFIED_RESPONSE_SCHEMA,
      zodSchema: unifiedSchema,
      maxAttempts: options?.forcedEvidence ? 2 : 3,
      validate: (parsed) => {
        const plan: QuestionPlan = {
          truthStrategy: slot.truthStrategy,
          domain: slot.domain as QuestionPlan['domain'],
          ruleId: slot.ruleId,
          sourceMaterial: ctx.curriculumContent.trim(),
        }
        const truth: TruthObject = {
          strategy: slot.truthStrategy,
          domain: slot.domain as TruthObject['domain'],
          values: Object.fromEntries(Object.entries(parsed.values ?? {}).filter(([, value]) => typeof value === 'number')) as Record<string, number>,
          derivedAnswer: parsed.claim,
          derivation: parsed.derivation,
          sourceEvidence: parsed.sourceEvidence,
          textEvidence: parsed.sourceEvidence,
          claim: parsed.claim,
          ruleInput: parsed.ruleInput,
        }

        try {
          gateStrategy(ctx, plan)
          gateTruth(ctx, plan, truth)
          return { value: parsed, issues: [] }
        } catch (error) {
          if (!(error instanceof StageGateError)) throw error
          const message = `[${error.gate}] ${error.message}`
          const unavailableRule = slot.truthStrategy === 'regra_deterministica'
            && (error.gate === 'rule_engine_missing' || /n[aã]o implementada/i.test(error.message))
          const evidenceFailure = error.gate === 'evidence_not_found' || error.gate === 'evidence_missing'
          return {
            value: parsed,
            issues: [message],
            stopRetry: unavailableRule,
            repairInstructions: [{
              code: unavailableRule ? 'RULE_UNAVAILABLE' : evidenceFailure ? 'EVIDENCE_NOT_FOUND' : 'RULE_INPUT_INVALID',
              fields: evidenceFailure ? ['sourceEvidence', 'claim', 'statement', 'supportText'] : ['ruleInput'],
              message: error.message,
              protectedFields: evidenceFailure ? ['truthStrategy', 'domain', 'ruleId', 'bnccCodes', 'bnccStatus'] : ['truthStrategy', 'ruleId'],
            }],
          }
        }
      },
    })
  } catch (error) {
    if (slot.truthStrategy === 'regra_deterministica' && error instanceof StructuredGenerationError && isUnavailableDeterministicRule(error)) {
      const fallbackSlot: BlueprintSlot = {
        ...slot,
        truthStrategy: 'fonte_ancorada',
        domain: undefined,
        ruleId: undefined,
        needsSupportText: true,
      }
      const fallback = await generateUnifiedQuestion(ctx, fallbackSlot, options)
      return {
        ...fallback,
        issues: [
          {
            severity: 'alerta',
            reason: '[strategy] A regra determinística indisponível foi substituída por uma questão ancorada literalmente no conteúdo curricular.',
          },
          ...fallback.issues,
        ],
      }
    }
    if (!options?.forcedEvidence && error instanceof StructuredGenerationError && isEvidenceValidationFailure(error)) {
      const evidence = literalEvidenceFallback(ctx.curriculumContent)
      if (evidence) {
        const fallbackSlot: BlueprintSlot = {
          ...slot,
          truthStrategy: 'fonte_ancorada',
          domain: undefined,
          ruleId: undefined,
          needsSupportText: true,
        }
        const fallback = await generateUnifiedQuestion(ctx, fallbackSlot, { ...options, forcedEvidence: evidence })
        return {
          ...fallback,
          issues: [
            {
              severity: 'alerta',
              reason: '[truth] A evidência anterior era inválida; a questão foi refeita com um trecho literal selecionado do currículo.',
            },
            ...fallback.issues,
          ],
        }
      }
    }
    throw error
  }

  const parsed = result.value
  const issues: Array<{ severity: 'bloqueante' | 'alerta'; reason: string }> = []

  // --- Montar QuestionPlan ---
  const plan: QuestionPlan = {
    truthStrategy: slot.truthStrategy,
    domain: slot.domain as QuestionPlan['domain'],
    ruleId: slot.ruleId,
    sourceMaterial: ctx.curriculumContent.trim(),
  }

  // --- Montar TruthObject ---
  let truth: TruthObject = {
    strategy: slot.truthStrategy,
    domain: slot.domain as TruthObject['domain'],
    values: Object.fromEntries(Object.entries(parsed.values ?? {}).filter(([, value]) => typeof value === 'number')) as Record<string, number>,
    derivedAnswer: parsed.claim,
    derivation: parsed.derivation,
    sourceEvidence: parsed.sourceEvidence,
    textEvidence: parsed.sourceEvidence,
    claim: parsed.claim,
    ruleInput: parsed.ruleInput,
  }

  // --- Aplicar gates determinísticos sobre a fonte de verdade ---
  try {
    gateStrategy(ctx, plan)
  } catch (error) {
    if (error instanceof StageGateError) {
      issues.push({ severity: 'bloqueante', reason: `[strategy] ${error.message}` })
    } else throw error
  }

  try {
    gateTruth(ctx, plan, truth)
    // gateTruth muta truth com valores recalculados
  } catch (error) {
    if (error instanceof StageGateError) {
      issues.push({ severity: 'bloqueante', reason: `[truth] ${error.message}` })
    } else throw error
  }

  // --- Montar VisualPlan ---
  const visualPlan: VisualPlan = {
    required: slot.needsVisual ? parsed.visualPlan.required : false,
    purpose: slot.needsVisual ? parsed.visualPlan.purpose : 'nenhum',
    visualType: slot.needsVisual ? parsed.visualPlan.visualType : 'none',
    rationale: parsed.visualPlan.rationale,
    whatIfImage: parsed.visualPlan.whatIfImage,
    data: slot.needsVisual ? parsed.visualPlan.data : undefined,
  }

  try {
    gateVisualPlan(visualPlan)
  } catch (error) {
    if (error instanceof StageGateError) {
      issues.push({ severity: 'alerta', reason: `[visual] ${error.message}` })
    }
  }

  // --- Montar alternativas ---
  let alternatives: Array<{ letter: string; text: string }> | null = null
  let correctLetter: string | null = null

  const correctAnswerText = plan.truthStrategy === 'calculavel' && plan.domain
    ? (getCanonicalDomain(plan.domain)?.compute(truth.values).answer.choiceDisplay ?? truth.derivedAnswer ?? '')
    : (truth.derivedAnswer ?? truth.claim ?? '')

  if (ctx.questionType === 'objetiva' && parsed.distractors) {
    try {
      gateAlternativePresentation(correctAnswerText)
    } catch (error) {
      if (error instanceof StageGateError) {
        issues.push({ severity: 'bloqueante', reason: `[alternativas] ${error.message}` })
      }
    }

    try {
      const expectedCount = (ctx.segment === 'anos-iniciais' ? 4 : 5) - 1
      if (parsed.distractors.length !== expectedCount) {
        issues.push({ severity: 'bloqueante', reason: `Esperados ${expectedCount} distratores, recebidos ${parsed.distractors.length}.` })
      } else {
        gateDistractors(plan, truth, parsed.distractors, correctAnswerText)
        gateInterpretiveSupport(plan, truth, parsed.distractors)
        const assembled = assembleAlternatives(parsed.distractors, correctAnswerText, shuffle)
        alternatives = assembled.alternatives
        correctLetter = assembled.correctLetter
      }
    } catch (error) {
      if (error instanceof StageGateError) {
        if (error.gate === 'distractor_duplicate' || error.gate === 'distractor_equals_answer' || error.gate === 'alternative_ambiguity') {
          const repaired = await repairDistractorsLocally({
            ctx,
            slot,
            plan,
            truth,
            statement: parsed.statement,
            supportText: parsed.supportText,
            bnccCodes: parsed.bnccCodes,
            correctAnswerText,
            distractors: parsed.distractors,
            failure: error,
          })
          const assembled = assembleAlternatives(repaired.distractors, correctAnswerText, shuffle)
          alternatives = assembled.alternatives
          correctLetter = assembled.correctLetter
          issues.push({ severity: 'alerta', reason: `[distratores] Reparo local aplicado: ${error.message}` })
          issues.push(...repaired.warnings.map((warning) => ({ severity: 'alerta' as const, reason: `[distratores] ${warning}` })))
        } else {
          issues.push({ severity: 'bloqueante', reason: `[distratores] ${error.message}` })
        }
      } else throw error
    }
  }

  // --- Validar enunciado ---
  const draft = { statement: parsed.statement, supportText: parsed.supportText }
  try {
    gateStatement(ctx, plan, truth, draft)
    gateVisualReference(visualPlan, draft)
  } catch (error) {
    if (error instanceof StageGateError) {
      issues.push({ severity: 'bloqueante', reason: `[enunciado] ${error.message}` })
    }
  }

  // --- Montar metadados ---
  const metadata: MetadataDraft = {
    bloomLevel: parsed.bloomLevel,
    bnccCodes: parsed.bnccCodes,
    bnccStatus: parsed.bnccStatus,
    bnccSummary: parsed.bnccSummary ?? null,
    pedagogicalClassification: {
      dok: parsed.dok,
      soloExpected: parsed.soloExpected,
      difficulty: parsed.difficulty ?? null,
      estimatedTimeMinutes: parsed.estimatedTimeMinutes ?? null,
    },
    needsImage: false,
    imageQuery: null,
  }

  try {
    gateMetadata(metadata)
  } catch (error) {
    if (error instanceof StageGateError) {
      issues.push({ severity: 'alerta', reason: `[metadados] ${error.message}` })
    }
  }

  // --- Montar questão ---
  const assembled: AssembledQuestion = {
    plan,
    truth,
    alternatives,
    correctLetter,
    visualPlan,
    statement: parsed.statement,
    supportText: parsed.supportText,
    metadata,
  }

  const hasBlocking = issues.some(i => i.severity === 'bloqueante')
  if (hasBlocking) {
    recordUnifiedRejection(ctx.subject, 'gate_failure', issues.filter(i => i.severity === 'bloqueante').map(i => i.reason).join('; '))
    // Lança erro para o chamador regenerar
    throw new StageGateError('stage0', 'unified_gate', issues.filter(i => i.severity === 'bloqueante').map(i => i.reason).join(' | '))
  }

  // --- Auditoria seletiva ---
  const needsAudit = shouldAudit(slot, parsed.selfConfidence)
  if (needsAudit) {
    recordAuditTriggered(ctx.subject, slot.truthStrategy)
    try {
      const auditIssues = await runSelectiveAudit(ctx, assembled)
      issues.push(...auditIssues)
      const blocking = auditIssues.filter(i => i.severity === 'bloqueante')
      if (blocking.length) {
        throw new StageGateError('stage5', 'audit', blocking.map(i => i.reason).join(' '))
      }
    } catch (error) {
      if (error instanceof StageGateError) throw error
      // Auditoria indisponível não bloqueia questão já validada deterministicamente
      const warning = unavailableAuditWarning(error)
      if (warning) issues.push(...warning)
    }
  } else {
    recordAuditSkipped(ctx.subject, `${slot.truthStrategy}_confidence_${parsed.selfConfidence.toFixed(2)}`)
  }

  const question = assembleExamQuestion(ctx, assembled)
  const durationMs = Date.now() - startMs
  recordUnifiedSuccess(ctx.subject, slot.truthStrategy, durationMs)

  return { question, issues, needsAudit }
}
