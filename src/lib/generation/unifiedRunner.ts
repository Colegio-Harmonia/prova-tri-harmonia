import { z } from 'zod'
import { generateValidatedStructuredContent, StructuredGenerationError } from '@/lib/gemini/structuredRepair'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { canonicalDomainsForSubject, getCanonicalDomain, computeCanonicalDomain, comparableNumber } from './domains'
import { getRuleEngine, registeredRuleEngineIds } from './rules'
import { defaultShuffle, assembleAlternatives, gateAnchoredClaim, gateAlternativePresentation, gateAlternativeShape, gateDistractors, gateInterpretiveSupport, gateMetadata, gateStatement, gateStrategy, gateTruth, gateVisualPlan, gateVisualReference } from './gates'
import { assembleExamQuestion } from './finalize'
import { curriculumLeakageIssues, normalizeQuestionPresentation } from './curriculumLeakage'
import { recordUnifiedAttempt, recordUnifiedSuccess } from './metrics'
import { StageGateError } from './types'
import type { AssembledQuestion, MetadataDraft, PipelineContext, QuestionPlan, TruthObject, VisualPlan } from './types'
import { TRUTH_STRATEGIES } from './types'
import type { BlueprintSlot } from './blueprint'
import { inferBloomFromVerb } from '@/config/bloomVerbs'
import { buildMathNotationInstruction } from '@/lib/math/notationInstruction'

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
  // Só descritivas: resposta-modelo e critérios escritos pela IA (nunca o título do capítulo).
  expectedAnswer: z.string().optional(),
  gradingCriteria: z.array(z.string().min(5)).optional(),
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
    expectedAnswer: { type: 'string' },
    gradingCriteria: { type: 'array', items: { type: 'string' } },
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

// ---------------------------------------------------------------------------
// Geração unificada (1 chamada IA por questão)
// ---------------------------------------------------------------------------

/** Habilidade BNCC-alvo: o gerador precisa saber o que a questão deve MEDIR, não só o assunto. */
export function buildSkillBlock(ctx: PipelineContext): string {
  const skills = ctx.targetSkills ?? []
  if (!skills.length) return ''
  const lines = skills.map((skill) => {
    const bloom = skill.description ? inferBloomFromVerb(skill.description) : null
    return `- ${skill.code}${skill.description ? ` — ${skill.description}` : ''}${bloom ? ` (verbo da habilidade → nível de Bloom esperado: ${bloom})` : ''}`
  })
  const objectives = (ctx.objectives ?? []).filter(Boolean).slice(0, 4)
  return `HABILIDADE BNCC-ALVO (obrigatória — é o que a questão deve MEDIR; o assunto do capítulo é só o contexto):
${lines.join('\n')}
${skills.length > 1 ? 'Escolha UMA delas e devolva exatamente esse código em "bnccCodes" com bnccStatus "mapeado".' : 'Devolva este código em "bnccCodes" com bnccStatus "mapeado".'}
A questão deve exigir a operação cognitiva do VERBO da habilidade aplicada ao objeto de conhecimento dela (ex.: "discutir/avaliar" pede julgar vantagens e limitações com base em dados do texto; "comparar" pede relacionar duas situações; "identificar" pode ser direto). Lembrar um fato isolado do assunto NÃO atende a uma habilidade de nível superior. Ajuste "bloomLevel" ao verbo.${objectives.length ? `\nObjetivos de aprendizagem do capítulo: ${objectives.join(' | ')}` : ''}
`
}

/** Regras que o juiz de qualidade aplica; o gerador as recebe antes de escrever. */
const QUALITY_RULES = `REGRAS DE QUALIDADE (o Jev avalia a questão pronta e direciona qualquer correção):
1. A questão mede a habilidade BNCC-alvo (quando informada), não apenas o assunto.
2. A resposta correta responde de fato à pergunta, com conteúdo da disciplina; nunca repete os termos da pergunta nem é um título/tópico.
3. Nada de linguagem de planejamento ("o estudo de...", "o capítulo...", "o currículo..."). Escreva para o aluno.
4. Objetiva: primeiro resolva o enunciado por completo. A alternativa correta e cada distrator devem responder a TODOS os itens pedidos, na mesma ordem, com os mesmos componentes, unidades, notação e nível de detalhe. É proibido colocar somente um número ou uma fórmula quando a pergunta também pede interpretação, comparação, classificação ou justificativa.
5. As cinco alternativas devem ter o mesmo padrão visual e gramatical. Nenhuma pode ser identificada como gabarito por ser a única composta por um número, frase, cálculo, unidade, explicação ou resposta completa. Distratores devem ser erros plausíveis, mas preencher os mesmos componentes da resposta.
6. Objetiva de Matemática: o estudante faz o cálculo; as alternativas exibem a resposta final pedida, sem fórmula usada, conta armada, etapas de resolução ou justificativa do cálculo. Não peça no enunciado para mostrar cálculos ou justificar a conta em uma questão objetiva. Preserve fórmulas quando a própria expressão algébrica for explicitamente a resposta solicitada. Preserve interpretações e conclusões conceituais que o enunciado pedir, mas sem expor a resolução numérica.
7. Exatamente uma alternativa é defensável.
8. Fatos corretos para a série. Em dúvida factual, use uma formulação mais simples e certa.
9. O enunciado NÃO repete o texto de apoio (o aluno já o vê em caixa própria) nem duplica instruções; apenas pergunta.
10. Descritiva: resposta esperada que realmente responde ao enunciado e critérios observáveis com pesos.
Exemplo RUIM: "Qual é um combustível renovável?" com alternativa correta "Combustíveis renováveis". Exemplo BOM: "Uma cidade troca ônibus a diesel por elétricos. Com base nos dados, qual argumento avalia a vantagem e a limitação da troca?" com alternativas de mesmo formato.
`

export function buildUnifiedPrompt(ctx: PipelineContext, slot: BlueprintSlot): string {
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
Escolha valores plausíveis e devolva em "values". O resultado oficial será recalculado por código.
NÃO invente números no enunciado que não estejam nos values.${ctx.questionType === 'objetiva' ? `
OBJETIVA CALCULÁVEL: em "claim", escreva a resposta correta completa ao enunciado, cobrindo todos os itens pedidos. Use o resultado calculado, mas não devolva apenas o valor numérico se a questão também pede comparação, interpretação, classificação ou outra conclusão. Em "distractors", escreva opções incorretas plausíveis que preencham os mesmos itens, na mesma ordem e com apresentação equivalente à de "claim". O Jev conferirá cada alternativa e o gabarito independentemente.` : ''}${ctx.questionType === 'descritiva' ? `
DESCRITIVA CALCULÁVEL: o enunciado DEVE pedir explicitamente a grandeza que o domínio calcula (${domain.title}) a partir dos valores de "values"; itens adicionais (justificar, interpretar, representar) são permitidos, mas esse item é obrigatório e não pode ser trocado por outra tarefa. Em "expectedAnswer", responda a TODOS os itens do enunciado, na ordem, e escreva o resultado numérico do cálculo; ele será conferido contra o recálculo por código e a questão é rejeitada se divergir.` : ''}`
  } else if (slot.truthStrategy === 'regra_deterministica' && engine) {
    strategyInstructions = `ESTRATÉGIA: REGRA DETERMINÍSTICA.
Motor de regras: ${engine.id} — ${engine.title}.
Entrada esperada em "ruleInput": ${engine.inputHint}
Preencha ruleInput EXATAMENTE com os campos que o motor espera. A forma correta será calculada por CÓDIGO a partir de ruleInput. NÃO decida a resposta gramatical.
PROIBIÇÃO: NÃO varie o tempo verbal dos distratores se a regra avalia apenas concordância.`
  } else if (slot.truthStrategy === 'fonte_ancorada') {
    strategyInstructions = `ESTRATÉGIA: FATO ANCORADO NO TEXTO DE APOIO.
O "Trecho curricular" acima é só o ESCOPO (lista de assuntos do capítulo). Ele NÃO é fonte de fatos nem de redação: nunca copie para a questão títulos, numeração de capítulo, tópicos ou frases dele, nem escreva "o estudo de...", "o capítulo...", "o currículo...".
1) Escreva você mesmo, em "supportText", um texto, situação ou dado autocontido (3–8 frases, tecnicamente correto para a série) sobre o assunto. Em questão objetiva conceitual curta, supportText pode ser null.
2) "sourceEvidence": copie palavra por palavra 1–2 frases do SEU supportText que sustentam a resposta (se supportText for null, escreva em uma frase a regra científica que justifica a resposta).
3) "claim": a resposta correta pronta para ser alternativa — concreta, com conteúdo da disciplina, no mesmo formato e tamanho dos distratores, sem repetir os termos da pergunta.`
  } else {
    strategyInstructions = `ESTRATÉGIA: INTERPRETATIVA.
O "Trecho curricular" acima é só o ESCOPO: nunca o copie. Escreva em "supportText" o texto a ser lido e, em "sourceEvidence", copie palavra por palavra a frase dele que sustenta UMA única leitura.
Escreva a leitura (resposta) em "claim", sem repetir os termos da pergunta.`
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

NOTAÇÃO MATEMÁTICA (OBRIGATÓRIA): ${buildMathNotationInstruction()}

${buildSkillBlock(ctx)}
${QUALITY_RULES}
${strategyInstructions}
${ctx.contentPlanInstruction ? `Instrução adicional: ${ctx.contentPlanInstruction}` : ''}

${ctx.questionType === 'objetiva' ? `Gere "claim" como a resposta correta e exatamente ${distCount} distratores em "distractors". Todos devem responder aos mesmos itens do enunciado, na mesma ordem e com os mesmos componentes e unidades. Para cálculos numéricos, apresente nas opções somente os resultados finais solicitados, sem fórmulas utilizadas, contas armadas, etapas ou justificativas de cálculo. Se a pergunta pedir explicitamente uma expressão algébrica, essa expressão é a resposta final e deve permanecer. Não peça para mostrar cálculos ou justificar a resolução no enunciado objetivo. Preserve as interpretações conceituais que forem pedidas, sem incluir a conta que levou ao resultado. Cada distrator representa um erro plausível, nunca a resposta correta. Não repita opções.` : 'Questão descritiva: não gere distratores. Preencha OBRIGATORIAMENTE "expectedAnswer" (resposta-modelo de 3–6 frases que um aluno nota 10 escreveria, respondendo ao enunciado) e "gradingCriteria" (3–5 critérios observáveis, cada um com seu peso em %, somando 100%).'}

O nome supportText é interno ao sistema e NUNCA pode aparecer no enunciado. Se houver texto de apoio, escreva "Leia o texto a seguir" ou "Considere o trecho abaixo"; nunca escreva nomes de campos, payload ou JSON para o estudante.

${visualInstructions}

Preencha também: bloomLevel, bnccCodes/bnccStatus (nunca invente código BNCC), dok, soloExpected com justificativa citando literalmente o enunciado.

Defina selfConfidence (0–1) indicando o quão confiante você está na qualidade e unicidade da questão.`
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

export function isEvidenceValidationFailure(error: StructuredGenerationError): boolean {
  // Os gates produzem diagnósticos em português ("evidência", "não").
  // Normalizar antes da comparação evita que a recuperação local deixe de
  // ser acionada apenas pela presença de acentos no texto do diagnóstico.
  const normalize = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  return error.failureCode === 'validation_rejected'
    && error.issues.some((issue) => /evidencia .*nao existe|evidencia .*vazia|evidence_(not_found|missing)/.test(normalize(issue)))
}

/** Calculável/regra seguem o recálculo por código; ancorada/interpretativa ancoram no texto de apoio. */
function verifyTruth(ctx: PipelineContext, plan: QuestionPlan, truth: TruthObject, supportText: string | null): void {
  if (plan.truthStrategy === 'calculavel' || plan.truthStrategy === 'regra_deterministica') {
    gateStrategy(ctx, plan)
    gateTruth(ctx, plan, truth)
    return
  }
  gateAnchoredClaim(supportText, truth)
}

export async function generateUnifiedQuestion(
  ctx: PipelineContext,
  slot: BlueprintSlot,
  options?: { shuffle?: <T>(items: T[]) => T[] },
): Promise<UnifiedGenerationResult> {
  const startMs = Date.now()
  const shuffle = options?.shuffle ?? defaultShuffle
  recordUnifiedAttempt(ctx.subject, slot.truthStrategy)

  const prompt = buildUnifiedPrompt(ctx, slot)

  let result: Awaited<ReturnType<typeof generateValidatedStructuredContent<typeof unifiedSchema._output>>>
  try {
    result = await generateValidatedStructuredContent({
      context: `generation/unified-${ctx.questionNumber}`,
      prompt,
      responseSchema: UNIFIED_RESPONSE_SCHEMA,
      zodSchema: unifiedSchema,
      maxAttempts: 2,
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
          // Em questões calculáveis, claim é a resposta redigida completa;
          // derivedAnswer fica reservado ao resultado canônico do recálculo.
          derivedAnswer: slot.truthStrategy === 'calculavel' ? undefined : parsed.claim,
          derivation: parsed.derivation,
          sourceEvidence: parsed.sourceEvidence,
          textEvidence: parsed.sourceEvidence,
          claim: parsed.claim,
          ruleInput: parsed.ruleInput,
        }

        try {
          verifyTruth(ctx, plan, truth, parsed.supportText)
          // Resposta, habilidade e completude serão avaliadas pelo Jev depois
          // que a questão inteira estiver montada.
          return { value: parsed, issues: [] }
        } catch (error) {
          if (!(error instanceof StageGateError)) throw error
          const message = `[${error.gate}] ${error.message}`
          const unavailableRule = slot.truthStrategy === 'regra_deterministica'
            && (error.gate === 'rule_engine_missing' || /n[aã]o implementada/i.test(error.message))
          const evidenceFailure = error.gate === 'evidence_not_found' || error.gate === 'evidence_missing'
          if (!unavailableRule) {
            // Um cálculo ou uma evidência que não bateu vira contexto para o
            // Jev avaliar; não rejeitamos a candidata dentro do gerador.
            return { value: parsed, issues: [] }
          }
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
    derivedAnswer: slot.truthStrategy === 'calculavel' ? undefined : parsed.claim,
    derivation: parsed.derivation,
    sourceEvidence: parsed.sourceEvidence,
    textEvidence: parsed.sourceEvidence,
    claim: parsed.claim,
    ruleInput: parsed.ruleInput,
  }

  // --- Aplicar gates determinísticos sobre a fonte de verdade ---
  try {
    verifyTruth(ctx, plan, truth, parsed.supportText)
    // verifyTruth muta truth com valores recalculados (calculável/regra)
  } catch (error) {
    if (error instanceof StageGateError) {
      issues.push({ severity: 'bloqueante', reason: `[truth] ${error.message}` })
      if (plan.truthStrategy === 'calculavel' && plan.domain) {
        try {
          const computation = computeCanonicalDomain(plan.domain, truth.values)
          truth.answerNumeric = computation.answer.numeric
          truth.derivedAnswer = computation.answer.display
          truth.derivation = computation.derivation
        } catch {
          // Mantém a candidata; a evidência informa ao Jev que o cálculo
          // não pôde ser conferido com os dados estruturados recebidos.
        }
      }
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

  // A alternativa correta precisa responder ao enunciado inteiro. O valor
  // canônico continua em derivedAnswer/answerNumeric para evidência e auditoria.
  let correctAnswerText = truth.claim?.trim() || truth.derivedAnswer || ''
  if (plan.truthStrategy === 'calculavel' && plan.domain) {
    try {
      const canonicalAnswer = getCanonicalDomain(plan.domain)?.compute(truth.values).answer.choiceDisplay
      correctAnswerText = truth.claim?.trim() || canonicalAnswer || truth.derivedAnswer || ''
    } catch (error) {
      issues.push({
        severity: 'bloqueante',
        reason: `[truth:recompute] O cálculo não pôde ser conferido antes do Jev: ${error instanceof Error ? error.message : 'dados inválidos'}.`,
      })
    }
  }

  if (ctx.questionType === 'objetiva') {
    const distractors = parsed.distractors ?? []
    try {
      gateAlternativePresentation(correctAnswerText)
      gateAlternativeShape(correctAnswerText, distractors)
    } catch (error) {
      if (error instanceof StageGateError) issues.push({ severity: 'bloqueante', reason: `[alternativas:${error.gate}] ${error.message}` })
    }
    const expectedCount = (ctx.segment === 'anos-iniciais' ? 4 : 5) - 1
    if (distractors.length !== expectedCount) {
      issues.push({ severity: 'bloqueante', reason: `[alternativas:quantidade] Esperados ${expectedCount} distratores, recebidos ${distractors.length}.` })
    }
    try {
      gateDistractors(plan, truth, distractors, correctAnswerText)
      gateInterpretiveSupport(plan, truth, distractors)
    } catch (error) {
      if (error instanceof StageGateError) issues.push({ severity: 'bloqueante', reason: `[distratores:${error.gate}] ${error.message}` })
      else throw error
    }
    // Mantém a candidata completa para que o Jev faça a primeira avaliação.
    const assembled = assembleAlternatives(distractors, correctAnswerText, shuffle)
    alternatives = assembled.alternatives
    correctLetter = assembled.correctLetter
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
    // Em calculável o resultado oficial vem do recálculo por código; a prosa do modelo
    // (resposta-modelo de todos os itens) já foi conferida contra ele em `validate`.
    expectedAnswer: parsed.expectedAnswer ?? null,
    gradingCriteria: parsed.gradingCriteria?.length ? parsed.gradingCriteria.map((item, index) => `${index + 1}) ${item.replace(/^\d+[.)]\s*/, '')}`).join(' ') : null,
    metadata,
  }

  const built = assembleExamQuestion(ctx, assembled)
  // O aluno já vê o texto de apoio na caixa própria: o enunciado não o repete.
  let question = normalizeQuestionPresentation(built)

  // --- Gate determinístico contra vazamento do escopo curricular ---
  const leakage = curriculumLeakageIssues(question, ctx.curriculumContent)
  issues.push(...leakage)

  // A auditoria Jev roda uma vez, depois que a questão está montada e
  // normalizada com o mesmo contexto que será persistido no relatório final.
  // Se bloquear, o diagnóstico orienta o reparo e apenas a versão corrigida
  // volta ao Jev.
  const needsAudit = true

  const durationMs = Date.now() - startMs
  recordUnifiedSuccess(ctx.subject, slot.truthStrategy, durationMs)

  return { question, issues, needsAudit }
}
