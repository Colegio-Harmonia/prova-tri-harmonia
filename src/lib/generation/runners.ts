import { z } from 'zod'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'
import { isImageEligibleSubject } from '@/config/imageEligibleSubjects'
import { canonicalDomainsForSubject, getCanonicalDomain } from './domains'
import { getRuleEngine, registeredRuleEngineIds } from './rules'
import type { AssembledQuestion, MetadataDraft, PipelineContext, QuestionPlan, StageRunners, StatementDraft, TruthObject } from './types'
import { TRUTH_STRATEGIES } from './types'

// Cada estágio é uma chamada isolada com um único contrato. As regras de cada
// prompt são só as relevantes àquela função (evita diluição de atenção).

const stage0Schema = z.object({
  truthStrategy: z.enum(TRUTH_STRATEGIES),
  domain: z.string().nullable().optional(),
  ruleId: z.string().nullable().optional(),
  rationale: z.string().min(1).max(400),
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

// Estágio 5 — auditoria de escopo reduzido: ambiguidade, alinhamento
// curricular e checagem independente do gabarito (o fato/cálculo já foi
// garantido nos Gates 1–3).
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
    difficulty: z.enum(['facil', 'media', 'dificil']).nullable().optional(),
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

function contextBlock(ctx: PipelineContext): string {
  return `Disciplina: ${ctx.subject}. Série: ${ctx.gradeYear}º ano (${ctx.segment}). Tipo de questão: ${ctx.questionType}.
Trecho curricular disponível:
${(ctx.curriculumContent || '(vazio)').slice(0, 6000)}
${ctx.contentPlanInstruction ? `Instrução da matriz: ${ctx.contentPlanInstruction}` : ''}`
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
  const result = await generateValidatedStructuredContent({ context: `generation/stage0-${ctx.questionNumber}`, prompt, responseSchema: STAGE0_SCHEMA, zodSchema: stage0Schema, maxAttempts: 1 })
  const parsed = result.value
  const plan: QuestionPlan = {
    truthStrategy: parsed.truthStrategy,
    domain: parsed.truthStrategy === 'calculavel' && parsed.domain && domains.some((domain) => domain.id === parsed.domain)
      ? (parsed.domain as QuestionPlan['domain'])
      : undefined,
    ruleId: parsed.ruleId ?? undefined,
    sourceMaterial: ctx.curriculumContent,
  }
  return plan
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
    const result = await generateValidatedStructuredContent({ context: `generation/stage1-${domain.id}-${ctx.questionNumber}`, prompt, responseSchema: STAGE1_VALUES_SCHEMA, zodSchema: stage1ValuesSchema, maxAttempts: 1 })
    return { strategy: plan.truthStrategy, domain: plan.domain, values: result.value.values, derivation: '' }
  }

  if (plan.truthStrategy === 'fonte_ancorada') {
    const prompt = `Você extrai a EVIDÊNCIA de um material curricular. Não escreva a questão.

${contextBlock(ctx)}

Copie LITERALMENTE um trecho curto (1–2 frases) do trecho curricular acima e escreva a alegação factual que ele sustenta. A cópia precisa existir palavra por palavra no material — evidência inventada é rejeitada.
Devolva {"evidence": "...", "claim": "...", "derivation": "por que a evidência sustenta a alegação"}.`
    const result = await generateValidatedStructuredContent({ context: `generation/stage1-anchor-${ctx.questionNumber}`, prompt, responseSchema: STAGE1_EVIDENCE_SCHEMA, zodSchema: stage1EvidenceSchema, maxAttempts: 1 })
    return { strategy: plan.truthStrategy, values: {}, derivation: result.value.derivation, sourceEvidence: result.value.evidence, claim: result.value.claim }
  }

  if (plan.truthStrategy === 'interpretativa') {
    const prompt = `Você seleciona a EVIDÊNCIA TEXTUAL de uma questão de interpretação. Não escreva a questão.

${contextBlock(ctx)}

Escolha um trecho literal do material acima que sustente UMA única leitura, e escreva a leitura (a resposta) que ele sustenta de forma unívoca. Não use trecho que admita duas leituras.
Devolva {"evidence": "...", "claim": "leitura única", "derivation": "por que não há leitura alternativa"}.`
    const result = await generateValidatedStructuredContent({ context: `generation/stage1-interp-${ctx.questionNumber}`, prompt, responseSchema: STAGE1_EVIDENCE_SCHEMA, zodSchema: stage1EvidenceSchema, maxAttempts: 1 })
    return { strategy: plan.truthStrategy, values: {}, derivation: result.value.derivation, textEvidence: result.value.evidence, derivedAnswer: result.value.claim }
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
  const result = await generateValidatedStructuredContent({ context: `generation/stage1-rule-${ctx.questionNumber}`, prompt, responseSchema: STAGE1_RULE_SCHEMA, zodSchema: stage1RuleSchema, maxAttempts: 1 })
  return { strategy: plan.truthStrategy, values: {}, derivation: result.value.derivation, claim: result.value.itemBase, ruleInput: result.value.ruleInput }
}

/** Estágio 2 — gera N−1 distratores. Não decide gabarito nem vê/gera enunciado. */
async function generateDistractors(ctx: PipelineContext, plan: QuestionPlan, truth: TruthObject): Promise<string[]> {
  const count = (ctx.segment === 'anos-iniciais' ? 4 : 5) - 1
  const answer = truth.derivedAnswer ?? truth.claim ?? ''
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

Cada distrator deve representar um erro típico plausível (nunca a resposta correta). Devolva {"distractors": ["...", ...]} com ${count} itens curtos, todos distintos entre si.`
  const result = await generateValidatedStructuredContent({ context: `generation/stage2-${ctx.questionNumber}`, prompt, responseSchema: STAGE2_RESPONSE_SCHEMA, zodSchema: stage2Schema, maxAttempts: 1 })
  return result.value.distractors
}

/** Estágio 3 — redige o enunciado sobre o objeto de verdade e as alternativas fixas. */
async function writeStatement(ctx: PipelineContext, plan: QuestionPlan, truth: TruthObject, alternatives: Array<{ letter: string; text: string }>): Promise<StatementDraft> {
  const prompt = `Você redige o ENUNCIADO de uma questão escolar. Você NÃO altera nenhum valor ou fato recebido.

Disciplina: ${ctx.subject}. Série: ${ctx.gradeYear}º ano (${ctx.segment}). Tipo: ${ctx.questionType}.
Objeto de verdade (imutável): ${JSON.stringify({ values: truth.values, derivacao: truth.derivation, evidencia: truth.sourceEvidence ?? truth.textEvidence ?? truth.claim ?? null })}.
Alternativas JÁ FIXAS (não mude o texto delas): ${alternatives.map((alternative) => `${alternative.letter}) ${alternative.text}`).join(' | ')}.

Contextualize pedagogicamente sem introduzir NENHUM número ou fato novo. Se faltar um dado, retorne o enunciado impossível de completar em vez de inventar (o gate rejeita números inventados).
Devolva {"statement": "...", "supportText": texto de apoio ou null}.`
  const result = await generateValidatedStructuredContent({ context: `generation/stage3-${ctx.questionNumber}`, prompt, responseSchema: STAGE3_RESPONSE_SCHEMA, zodSchema: stage3Schema, maxAttempts: 1 })
  return { statement: result.value.statement, supportText: result.value.supportText ?? null }
}

/** Estágio 4 — metadados pedagógicos sobre o enunciado já pronto. */
async function generateMetadata(ctx: PipelineContext, truth: TruthObject, statement: StatementDraft, alternatives: Array<{ letter: string; text: string }>, correctLetter: string | null): Promise<MetadataDraft> {
  const imageEligible = isImageEligibleSubject(ctx.subject)
  const imageInstruction = imageEligible
    ? `Decida também needsImage (boolean) e imageQuery (descrição curta, em português, do recurso visual) SOMENTE se a questão realmente precisar de uma imagem de apoio (gráfico, mapa, figura, estrutura). Caso contrário, needsImage:false e imageQuery:null.`
    : `Defina needsImage:false e imageQuery:null (disciplina não habilitada para imagem).`
  const prompt = `Você classifica pedagogicamente uma questão PRONTA. Não altere enunciado, alternativas nem gabarito.

Disciplina: ${ctx.subject}. Série: ${ctx.gradeYear}º ano.
Enunciado: ${statement.statement}
${statement.supportText ? `Apoio: ${statement.supportText}` : ''}
Alternativas: ${alternatives.map((alternative) => `${alternative.letter}) ${alternative.text}`).join(' | ')}. Gabarito: ${correctLetter ?? '—'}.

Devolva bloomLevel, bnccCodes/bnccStatus/bnccSummary (nunca invente código BNCC; se não houver, use [] e "nao_mapeado"), pedagogicalClassification (DOK/SOLO) com justificativa e evidência citando literalmente o enunciado. ${imageInstruction}`
  const result = await generateValidatedStructuredContent({ context: `generation/stage4-${ctx.questionNumber}`, prompt, responseSchema: STAGE4_RESPONSE_SCHEMA, zodSchema: stage4Schema, maxAttempts: 1 })
  return {
    ...result.value,
    bnccSummary: result.value.bnccSummary ?? null,
    needsImage: imageEligible ? Boolean(result.value.needsImage) : false,
    imageQuery: imageEligible ? (result.value.imageQuery ?? null) : null,
  }
}

/**
 * Estágio 5 — auditoria de escopo reduzido. O fato/cálculo já foi garantido
 * pelos Gates 1–3; aqui só sobra ambiguidade, alinhamento curricular real e a
 * conferência INDEPENDENTE do gabarito como segunda camada.
 */
async function audit(ctx: PipelineContext, assembled: AssembledQuestion): Promise<Array<{ severity: 'bloqueante' | 'alerta'; reason: string }>> {
  const prompt = `Você faz a AUDITORIA FINAL de uma questão escolar já construída. O fato/cálculo já foi garantido por validação determinística; NÃO recalcule do zero. Foque apenas em: ambiguidade de linguagem, alinhamento curricular real e defesa independente do gabarito.

Disciplina: ${ctx.subject}. Série: ${ctx.gradeYear}º ano (${ctx.segment}).
Enunciado: ${assembled.statement}
${assembled.supportText ? `Apoio: ${assembled.supportText}` : ''}
Alternativas: ${(assembled.alternatives ?? []).map((alternative) => `${alternative.letter}) ${alternative.text}`).join(' | ') || '(questão descritiva)'}
Gabarito definido por código: ${assembled.correctLetter ?? '—'}

Devolva issues (bloqueante somente com evidência concreta) e, para objetiva, answerKeyAudit derivando a letra correta de forma independente e comparando com o gabarito acima.`
  const result = await generateValidatedStructuredContent({ context: `generation/stage5-${ctx.questionNumber}`, prompt, responseSchema: STAGE5_SCHEMA, zodSchema: stage5Schema, maxAttempts: 1 })
  const issues = result.value.issues.map((issue) => ({ severity: issue.severity, reason: `[${issue.criterion}] ${issue.reason}` }))
  const auditResult = result.value.answerKeyAudit
  if (assembled.alternatives && assembled.correctLetter) {
    if (!auditResult) {
      issues.push({ severity: 'bloqueante', reason: 'Auditoria não apresentou a conferência independente do gabarito.' })
    } else if (auditResult.declaredLetter !== assembled.correctLetter || auditResult.independentlyDerivedLetter !== assembled.correctLetter || !auditResult.matchesDeclared) {
      issues.push({ severity: 'bloqueante', reason: `Conferência independente do gabarito diverge: definido ${assembled.correctLetter}, calculado ${auditResult.independentlyDerivedLetter ?? 'sem alternativa única'}. ${auditResult.evidence}` })
    }
  }
  return issues
}

export const llmStageRunners: StageRunners = {
  classifyStrategy: (ctx) => classifyStrategy(ctx),
  generateTruth: (ctx, plan) => generateTruth(ctx, plan),
  generateDistractors: (ctx, plan, truth) => generateDistractors(ctx, plan, truth),
  writeStatement: (ctx, plan, truth, alternatives) => writeStatement(ctx, plan, truth, alternatives),
  generateMetadata: (ctx, truth, statement, alternatives, correctLetter) => generateMetadata(ctx, truth, statement, alternatives, correctLetter),
  audit: (ctx, assembled) => audit(ctx, assembled),
}
