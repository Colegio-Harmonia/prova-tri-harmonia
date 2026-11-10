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
import { getOfficialBnccSkill } from '@/lib/curriculum/officialBncc'
import { buildMathNotationInstruction } from '@/lib/math/notationInstruction'
import { alternativesCountForSegment } from '@/lib/gemini/promptBuilder'

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
  // A etapa posterior ao Jev gera respostas para um enunciado aprovado; esses
  // campos são opcionais para não pedir ao modelo que reescreva o enunciado.
  supportText: z.string().nullable().optional(),
  statement: z.string().min(20).optional(),

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
  required: ['derivation', 'visualPlan', 'bloomLevel', 'dok', 'soloExpected', 'selfConfidence'],
}

// ---------------------------------------------------------------------------
// Geração unificada (1 chamada IA por questão)
// ---------------------------------------------------------------------------

/** Habilidade BNCC-alvo: o gerador precisa saber o que a questão deve MEDIR, não só o assunto. */
export function buildSkillBlock(ctx: PipelineContext): string {
  const enem = ctx.targetEnemSkill
  const enemBlock = enem
    ? `HABILIDADE ENEM-ALVO (Matriz de Referência do ENEM, definida no planejamento — é o que a questão deve MEDIR): ${enem.code}${enem.description ? ` — ${enem.description}` : ''}
A tarefa do aluno precisa exigir exatamente essa habilidade, no formato de item do ENEM (texto-base autêntico + comando). O código ENEM é registrado pelo sistema; não o escreva no enunciado.
`
    : ''
  const skills = ctx.targetSkills ?? []
  if (!skills.length) return enemBlock
  const lines = skills.map((skill) => {
    const official = getOfficialBnccSkill(skill.code)
    const description = official?.text ?? skill.description
    const bloom = description ? inferBloomFromVerb(description) : null
    const context = official?.context.length ? `\n  Componente, unidade e objeto oficiais: ${official.context.join('; ')}` : ''
    const source = official ? `\n  Fonte BNCC ${official.dataVersion}: ${official.source}` : '\n  ATENÇÃO: código sem correspondência oficial; não invente significado ou objeto.'
    return `- ${official?.code ?? skill.code}${description ? ` — ${description}` : ''}${bloom ? ` (verbo da habilidade → nível de Bloom esperado: ${bloom})` : ''}${context}${source}`
  })
  const objectives = (ctx.objectives ?? []).filter(Boolean).slice(0, 4)
  return `HABILIDADE BNCC-ALVO (obrigatória — é o que a questão deve MEDIR; o assunto do capítulo é só o contexto):
${lines.join('\n')}
${skills.length > 1 ? 'Escolha UMA delas e devolva exatamente esse código em "bnccCodes" com bnccStatus "mapeado".' : 'Devolva este código em "bnccCodes" com bnccStatus "mapeado".'}
A questão deve exigir a operação cognitiva do VERBO da habilidade aplicada ao objeto de conhecimento dela (ex.: "discutir/avaliar" pede julgar vantagens e limitações com base em dados do texto; "comparar" pede relacionar duas situações; "identificar" pode ser direto). Lembrar um fato isolado do assunto NÃO atende a uma habilidade de nível superior. Ajuste "bloomLevel" ao verbo.${objectives.length ? `\nObjetivos de aprendizagem do capítulo: ${objectives.join(' | ')}` : ''}
${enemBlock}`
}

/** Regras que o juiz de qualidade aplica; o gerador as recebe antes de escrever. */
const QUALITY_RULES = `REGRAS DE QUALIDADE (o Jev avalia a questão pronta e direciona qualquer correção):
1. A questão mede a habilidade BNCC-alvo (quando informada), não apenas o assunto.
2. A resposta correta responde de fato à pergunta, com conteúdo da disciplina; nunca repete os termos da pergunta nem é um título/tópico.
3. Nada de linguagem de planejamento ("o estudo de...", "o capítulo...", "o currículo..."). Escreva para o aluno.
4. Objetiva: primeiro resolva o enunciado por completo. A alternativa correta e cada distrator devem responder a TODOS os itens pedidos, na mesma ordem, com os mesmos componentes, unidades, notação e nível de detalhe. É proibido colocar somente um número ou uma fórmula quando a pergunta também pede interpretação, comparação, classificação ou justificativa.
5. Todas as alternativas (na quantidade definida para esta etapa) devem ter o mesmo padrão visual e gramatical. Nenhuma pode ser identificada como gabarito por ser a única composta por um número, frase, cálculo, unidade, explicação ou resposta completa. Distratores devem ser erros plausíveis, mas preencher os mesmos componentes da resposta. Escreva primeiro a resposta correta; depois modele cada distrator com a mesma estrutura, sintaxe, número de elementos, unidades e notação. Mantenha extensão aproximadamente equivalente (diferença máxima de 25%, quando aplicável) e altere apenas o elemento que torna o distrator incorreto.
6. Objetiva de Matemática: o estudante faz o cálculo; as alternativas exibem a resposta final pedida, sem fórmula usada, conta armada, etapas de resolução ou justificativa do cálculo. Não peça no enunciado para mostrar cálculos ou justificar a conta em uma questão objetiva. Preserve fórmulas quando a própria expressão algébrica for explicitamente a resposta solicitada. Preserve interpretações e conclusões conceituais que o enunciado pedir, mas sem expor a resolução numérica.
7. Em nenhuma disciplina inclua comentários editoriais nas alternativas, como "correto", "incorreto", "confundiu", "a resposta certa é", explicações do erro ou correções de outras opções. Escreva apenas a resposta que o aluno deve avaliar; mantenha justificativas dos distratores fora do conteúdo exibido ao aluno.
8. Enunciado e apoio podem apresentar dados necessários, mas não podem antecipar, explicar ou praticamente ditar a conclusão que o aluno deve produzir. Antes de finalizar, procure a conclusão solicitada no enunciado e no apoio; se estiver declarada, reescreva esse trecho como dado ou observação sem remover informações necessárias.
9. Exatamente uma alternativa é defensável.
10. Fatos corretos para a série. Em dúvida factual, use uma formulação mais simples e certa. Evite números, datas e nomes próprios específicos, salvo quando necessários e confirmados no material disponível.
11. O enunciado NÃO repete o texto de apoio (o aluno já o vê em caixa própria) nem duplica instruções; apenas pergunta.
12. Descritiva: resposta esperada que realmente responde ao enunciado e critérios observáveis com pesos.
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
1) Não gere texto de apoio por padrão. Use supportText:null se a habilidade puder ser avaliada sem interpretar material. Só crie texto, tabela, gráfico ou conjunto de dados quando a habilidade exigir essa interpretação; inclua apenas evidências/dados necessários, sem explicar o conceito, antecipar a conclusão ou entregar a resposta. Antes de finalizar, verifique se basta localizar/copiar o apoio para responder; se sim, reformule-o.
2) O planejamento delimita o tema, mas uma lista de tópicos não comprova fatos específicos. Não copie títulos/tópicos como fatos. Se não houver fonte factual, use um cenário hipotético identificado como tal, com dados simples e internamente coerentes; evite estatísticas, datas ou nomes próprios não fornecidos.
3) "sourceEvidence": copie palavra por palavra 1–2 frases do SEU supportText que fornecem premissas ou dados, nunca a conclusão pronta. Se supportText for null, registre a regra factual usada; ela não pode aparecer no enunciado.
4) "claim": a conclusão que decorre das premissas — concreta, com conteúdo da disciplina, no mesmo formato e tamanho dos distratores, sem repetir os termos da pergunta. Nenhuma frase do supportText, copiada isoladamente, pode ser a resposta correta.`
  } else {
    strategyInstructions = `ESTRATÉGIA: INTERPRETATIVA.
O "Trecho curricular" acima é só o ESCOPO: nunca o copie. Só escreva em "supportText" o texto/dado que o aluno precisa interpretar para cumprir a habilidade; caso contrário use null. Quando houver apoio, inclua evidências necessárias e nunca a interpretação pronta. Em "sourceEvidence", copie a evidência literal do apoio; sem apoio, registre a regra factual interna.
Escreva a leitura (resposta) em "claim", sem repetir os termos da pergunta. O apoio não pode conter uma frase que, copiada isoladamente, responda à pergunta.`
  }

  const distCount = ctx.questionType === 'objetiva'
    ? alternativesCountForSegment(ctx.segment as 'anos-iniciais' | 'anos-finais' | 'ensino-medio') - 1
    : 0

  const visualInstructions = slot.needsVisual
    ? 'O blueprint exige recurso visual. Escolha o tipo mais específico, informe purpose e extraia em data apenas dados do objeto de verdade.'
    : 'NÃO use recurso visual. Defina required:false, purpose:"nenhum", visualType:"none". Não faça referência a figura, imagem, gráfico, mapa ou diagrama no enunciado.'
  const regenerationInstructions = ctx.regenerationMode === 'safe'
    ? 'MODO BASE SEGURA: produza uma questão simples e inequívoca, ainda alinhada ao verbo BNCC, com um único passo de raciocínio e vocabulário da série. Use um único fato central; texto de apoio curto apenas com dados/premissas; alternativas curtas, paralelas e da mesma estrutura. Evite números, datas e nomes dispensáveis. Preserve tipo, capítulo, habilidade e recurso visual obrigatórios.'
    : ctx.regenerationMode === 'alternate_angle'
      ? 'REGENERAÇÃO DIVERSIFICADA: mantenha capítulo, habilidade, tipo e recurso visual definidos, mas escolha um ângulo de aplicação diferente do anterior. Não repita a estrutura narrativa, o texto de apoio nem a mesma operação superficial.'
      : ''

  const approvedStatementInstruction = ctx.approvedStatement
    ? `ENUNCIADO JÁ APROVADO PELO JEV — NÃO REESCREVA NEM inclua os campos statement ou supportText na sua resposta. Use este conteúdo imutável apenas para produzir as respostas:\n${JSON.stringify({ statement: ctx.approvedStatement.statement, supportText: ctx.approvedStatement.supportText })}\n`
    : ''

  return `Você é um especialista em elaboração de respostas para avaliação educacional.

Complete os campos de resposta e metadados da questão em uma resposta JSON. O enunciado já foi aprovado e deve ser preservado literalmente.

Disciplina: ${ctx.subject}. Etapa: ${ctx.segment}. Série: ${ctx.gradeYear}º ano${ctx.classLabel ? `, turma ${ctx.classLabel}` : ''}. Tipo: ${ctx.questionType}.
Dificuldade alvo: ${slot.difficulty}. Ângulo temático: ${slot.coreTopic}.
CALIBRAGEM PEDAGÓGICA: escreva para estudantes do ano e etapa informados. Use apenas pré-requisitos esperados até este ano; controle vocabulário, abstração e quantidade de etapas. A habilidade BNCC e a dificuldade alvo definem o desafio pretendido, mas não autorizam pressupor conteúdo posterior.

Trecho curricular disponível:
${ctx.curriculumContent.slice(0, 3000)}

REGRA DE FONTE TEXTUAL (OBRIGATÓRIA): só mencione texto, trecho, artigo, poema, capítulo ou “material didático” se o campo "supportText" trouxer integralmente a fonte que o estudante precisa ler. Esse campo deve conter um texto/dado autocontido, nunca apenas título, número de capítulo, lista de tópicos ou resumo inventado. Os tópicos curriculares acima não são um texto de leitura. Se não houver fonte textual suficiente, formule uma questão autocontida e não faça referência a leitura, capítulo ou material externo.

NOTAÇÃO MATEMÁTICA (OBRIGATÓRIA): ${buildMathNotationInstruction()}

${buildSkillBlock(ctx)}
${QUALITY_RULES}
${strategyInstructions}
${ctx.contentPlanInstruction ? `Instrução adicional: ${ctx.contentPlanInstruction}` : ''}
${approvedStatementInstruction}
${regenerationInstructions}

${ctx.questionType === 'objetiva' ? `Gere "claim" como a resposta correta e exatamente ${distCount} distratores em "distractors", seguindo as regras 4 a 6 acima. Cada distrator deve ser um erro plausível, nunca a resposta correta. Não repita opções.` : 'Questão descritiva: não gere distratores. Preencha OBRIGATORIAMENTE "expectedAnswer" com resposta concisa que responda ao enunciado, sem impor tamanho de redação quando a tarefa pede um resultado curto, e "gradingCriteria" com critérios observáveis, cada um com seu peso em %, somando 100%.'}

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

/** Contrato de resposta específico por tipo, conferido antes de montar a questão. */
function responseContractIssues(
  questionType: PipelineContext['questionType'],
  parsed: z.infer<typeof unifiedSchema>,
  expectedDistractors: number,
): string[] {
  if (questionType === 'objetiva') {
    const issues: string[] = []
    if (!parsed.claim?.trim()) issues.push('claim: resposta correta ausente; produza a resposta que resolve o enunciado.')
    if (parsed.distractors?.length !== expectedDistractors) {
      issues.push(`distractors: esperados exatamente ${expectedDistractors} distratores para completar cinco alternativas A–E; recebidos ${parsed.distractors?.length ?? 0}.`)
    }
    const normalizeAnswer = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const normalizedClaim = normalizeAnswer(parsed.claim ?? '')
    const normalizedDistractors = (parsed.distractors ?? []).map(normalizeAnswer)
    if (new Set(normalizedDistractors).size !== normalizedDistractors.length) {
      issues.push('distractors: há alternativas repetidas; reescreva apenas os distratores repetidos para que cada alternativa tenha conteúdo distinto.')
    }
    if (normalizedClaim && normalizedDistractors.includes(normalizedClaim)) {
      issues.push('distractors: uma alternativa incorreta repete a resposta correta; substitua esse distrator sem alterar o enunciado aprovado.')
    }
    return issues
  }
  const issues: string[] = []
  if (!parsed.expectedAnswer?.trim()) issues.push('expectedAnswer: resposta esperada ausente ou vazia.')
  if (!parsed.gradingCriteria?.length) issues.push('gradingCriteria: informe critérios de correção observáveis para a resposta esperada.')
  return issues
}

export async function generateUnifiedQuestion(
  ctx: PipelineContext,
  slot: BlueprintSlot,
  options?: { shuffle?: <T>(items: T[]) => T[]; onSchemaValidated?: () => Promise<void> | void },
): Promise<UnifiedGenerationResult> {
  const invalidSkillCodes = (ctx.targetSkills ?? []).filter((skill) => !getOfficialBnccSkill(skill.code)).map((skill) => skill.code)
  if (invalidSkillCodes.length) {
    throw new Error(`Código(s) de habilidade sem correspondência no @bncc/dados: ${invalidSkillCodes.join(', ')}. Corrija o mapeamento curricular antes de gerar.`)
  }
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
      // Uma segunda chamada só corrige formato/campos inválidos, mantendo o
      // enunciado aprovado fixo no prompt; ela não reinicia o estágio anterior.
      maxAttempts: 2,
      validate: (parsed) => {
        const responseIssues = responseContractIssues(
          ctx.questionType,
          parsed,
          alternativesCountForSegment(ctx.segment as 'anos-iniciais' | 'anos-finais' | 'ensino-medio') - 1,
        )
        if (responseIssues.length) {
          return {
            value: parsed,
            issues: responseIssues,
            repairInstructions: responseIssues.map((message) => ({
              code: 'RESPONSE_CONTRACT',
              fields: ctx.questionType === 'objetiva' ? ['claim', 'distractors'] : ['expectedAnswer', 'gradingCriteria'],
              message,
              protectedFields: ['approvedStatement', 'supportText', 'questionType', 'metadata'],
            })),
          }
        }
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
          verifyTruth(ctx, plan, truth, ctx.approvedStatement?.supportText ?? parsed.supportText ?? null)
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

  await options?.onSchemaValidated?.()
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
    verifyTruth(ctx, plan, truth, ctx.approvedStatement?.supportText ?? parsed.supportText ?? null)
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
    required: slot.needsVisual,
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
    const expectedCount = alternativesCountForSegment(ctx.segment as 'anos-iniciais' | 'anos-finais' | 'ensino-medio') - 1
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
  const draft = ctx.approvedStatement ?? { statement: parsed.statement ?? '', supportText: parsed.supportText ?? null }
  try {
    gateStatement(ctx, plan, truth, draft)
    gateVisualReference(visualPlan, draft)
  } catch (error) {
    if (error instanceof StageGateError) {
      issues.push({ severity: 'bloqueante', reason: `[enunciado] ${error.message}` })
    }
  }

  // --- Montar metadados ---
  const allowedSkills = ctx.targetSkills ?? []
  const selectedSkill = allowedSkills.length
    ? allowedSkills.find((skill) => parsed.bnccCodes.some((code) => code.trim().toUpperCase() === skill.code.trim().toUpperCase())) ?? allowedSkills[0]
    : null
  const officialSelectedSkill = selectedSkill ? getOfficialBnccSkill(selectedSkill.code) : null
  const unplannedCodes = parsed.bnccCodes.filter((code) => !allowedSkills.some((skill) => skill.code.trim().toUpperCase() === code.trim().toUpperCase()))
  if (unplannedCodes.length) issues.push({ severity: 'alerta', reason: `[bncc] Código(s) fora da lista autorizada ignorado(s): ${unplannedCodes.join(', ')}.` })
  const metadata: MetadataDraft = {
    bloomLevel: parsed.bloomLevel,
    bnccCodes: selectedSkill ? [officialSelectedSkill?.code ?? selectedSkill.code] : [],
    bnccStatus: selectedSkill ? 'mapeado' : 'nao_mapeado',
    bnccSummary: officialSelectedSkill?.text ?? selectedSkill?.description ?? null,
    pedagogicalClassification: {
      dok: parsed.dok,
      soloExpected: parsed.soloExpected,
      difficulty: slot.difficulty,
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
    statement: draft.statement,
    supportText: draft.supportText,
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
