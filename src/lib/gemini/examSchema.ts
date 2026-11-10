import { z } from 'zod'
import { qualityDiagnosticSchema } from '@/lib/exams/qualityDiagnostics'

export const BLOOM_LEVELS = ['lembrar', 'compreender', 'aplicar', 'analisar', 'avaliar', 'criar'] as const
export const DOK_LEVELS = ['DOK_1', 'DOK_2', 'DOK_3', 'DOK_4'] as const
export const SOLO_EXPECTED_LEVELS = ['UNIESTRUTURAL', 'MULTIESTRUTURAL', 'RELACIONAL', 'ABSTRATO_AMPLIADO'] as const

const pedagogicalClassificationSchema = z.object({
  dok: z.object({
    categoryCode: z.enum(DOK_LEVELS),
    confidence: z.number().min(0).max(1),
    justification: z.string(),
    evidence: z.string(),
  }),
  soloExpected: z.object({
    categoryCode: z.enum(SOLO_EXPECTED_LEVELS),
    confidence: z.number().min(0).max(1),
    justification: z.string(),
    evidence: z.string(),
  }),
  estimatedTimeMinutes: z.number().positive().nullable().optional(),
  difficulty: z.enum(['facil', 'media', 'dificil']).nullable().optional(),
})

// Ficha técnica interna. Ela é persistida junto da questão, mas não é
// exibida na prova: serve para manter enunciado, solução, gabarito e visual
// ancorados no mesmo modelo verificável.
// Domínios com recalculador determinístico (motor em
// `@/lib/generation/domains`). `other` permanece aceito apenas para leitura
// de questões antigas já persistidas — o Gate 0 do pipeline fragmentado
// proíbe escolhê-lo em gerações novas.
const solutionBlueprintObjectSchema = z.object({
  domain: z.enum(['linear_system', 'rectangular_prism_volume', 'average_speed', 'percentage', 'ratio_proportion', 'simple_interest', 'compound_interest', 'arithmetic_progression', 'geometric_progression', 'linear_recurrence', 'linear_recurrence_order2', 'linear_function', 'quadratic_function', 'point_distance', 'circle_relative_position', 'sphere_point_position', 'kinematics_uniform', 'kinematics_accelerated', 'newton_second_law', 'weight_force', 'kinetic_energy', 'ohms_law', 'electric_power', 'density', 'mole_calculation', 'molar_concentration', 'solution_dilution', 'other']),
  // A ficha é interna. O modelo ocasionalmente devolve um rótulo mais
  // descritivo aqui; isso não pode invalidar toda uma prova por limite de
  // apresentação, pois os campos que determinam o cálculo são equations e
  // values, validados separadamente.
  variables: z.array(z.object({ symbol: z.string().min(1).max(80), meaning: z.string().min(1) })).default([]),
  equations: z.array(z.string().min(1)).default([]),
  values: z.record(z.string(), z.number()).default({}),
  calculationSteps: z.array(z.string().min(1)).min(1),
  derivedAnswer: z.string().min(1),
  visualSpec: z.enum(['none', 'blank_coordinate_plane', 'coordinate_plane', 'chart']).default('none'),
}).nullable()

/**
 * Alguns provedores retornam objetos JSON serializados como string. O
 * blueprint é contrato interno e não deve transformar esse erro de
 * apresentação em falha de toda a geração quando a string contém JSON válido.
 * Texto livre continua inválido e seguirá para a tentativa de correção do
 * contrato estruturado.
 */
export const solutionBlueprintSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}, solutionBlueprintObjectSchema).optional()

const acervoContentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('image'), mediaId: z.number().int().positive().safe(), alt: z.string(), width: z.number().positive().optional() }),
])

export const examQuestionSchema = z.object({
  // Identificador estável do slot no blueprint de prova completa. Ausente em
  // questões legadas e em itens importados do banco.
  slotId: z.string().min(1).optional(),
  number: z.number().int(),
  // Vínculo opcional com a linha do planejamento escolar. Provas antigas
  // continuam válidas; novas provas com matriz preenchem este campo.
  curriculumUnitRowIndex: z.number().int().nullable().optional(),
  // 'ia' = gerada pelo Gemini (padrão). 'enem_bank' = questão real de uma
  // prova passada do ENEM, escolhida manualmente pela coordenação na tela
  // de geração — nunca regenerada, nunca editada pela IA.
  source: z.enum(['ia', 'enem_bank', 'acervo']).default('ia'),
  acervoRef: z.object({
    questionId: z.number().int(), origin: z.string(), externalId: z.string().nullable(),
    portalUrl: z.string().nullable(), importedAt: z.string(),
    original: z.record(z.unknown()),
  }).nullable().optional(),
  acervoFallbackReason: z.string().optional(),
  // Derived for presentation from the saved original, without executing HTML.
  acervoInlineContent: z.object({ statement: z.array(acervoContentPartSchema).optional(), alternatives: z.record(z.array(acervoContentPartSchema)).optional() }).optional(),
  enemBankRef: z.object({ questionId: z.number().int(), year: z.number().int() }).nullable().optional(),
  type: z.enum(['objetiva', 'descritiva']),
  // Valor máximo em pontos. Pode ser ajustado pelo professor na revisão
  // antes da aplicação; a correção guarda uma cópia para não mudar o
  // histórico caso a prova seja editada depois.
  weight: z.number().positive().max(100).optional(),
  bloomLevel: z.enum(BLOOM_LEVELS),
  bloomAssessment: z.object({ status: z.enum(['classified', 'unavailable']), source: z.enum(['provider', 'cache', 'fallback']), model: z.string(), confidence: z.number().min(0).max(1).nullable(), scores: z.record(z.number()).optional(), classifiedAt: z.string() }).optional(),
  inepAssessment: z.object({
    version: z.string(),
    status: z.enum(['classified', 'no_match', 'unavailable', 'not_applicable']),
    matrix: z.enum(['enem', 'novo_saeb', 'classica']).nullable(),
    source: z.enum(['provider', 'cache', 'fallback']), model: z.string(),
    confidence: z.number().min(0).max(1).nullable(), classifiedAt: z.string(),
    area: z.object({ code: z.string(), description: z.string() }).nullable(),
    competency: z.object({ code: z.string(), description: z.string() }).nullable(),
    skill: z.object({ code: z.string(), description: z.string() }).nullable(),
    approximate: z.boolean(), referenceGrade: z.number().int().nullable(),
    errorCode: z.string().optional(),
  }).optional(),
  statement: z.string(),
  supportText: z.string().nullable().optional(),
  alternatives: z.array(z.object({
    letter: z.string(),
    text: z.string(),
    // Só questões do banco ENEM: alternativa que é figura (gráfico, estrutura
    // química) chega com `text` nulo e a figura original em `image`, já
    // importada pro Drive — nunca preenchido pela IA.
    image: z.object({ driveFileId: z.string(), previewUrl: z.string(), sourceUrl: z.string().nullable().optional() }).nullable().optional(),
  })).nullable().optional(),
  correctLetter: z.string().nullable().optional(),
  expectedAnswer: z.string().nullable().optional(),
  gradingCriteria: z.string().nullable().optional(),
  solutionBlueprint: solutionBlueprintSchema,
  // Resolução passo a passo com foco pedagógico (Módulo 3 — atividade de
  // reforço ENEM): gerada pelo DeepSeek DEPOIS da seleção das questões do
  // banco, nunca pela geração de prova comum. Vai pro documento "Gabarito
  // Comentado" da atividade.
  commentedResolution: z.string().nullable().optional(),
  bnccCodes: z.array(z.string()),
  bnccAssessment: z.object({
    version: z.string(), status: z.enum(['classified', 'no_match', 'unavailable']), source: z.enum(['provider', 'cache', 'fallback']),
    model: z.string(), thresholdPercent: z.number().min(0).max(100), assessedAt: z.string(),
    scores: z.array(z.object({ code: z.string(), scorePercent: z.number().min(0).max(100) })), candidateCount: z.number().int(), errorCode: z.string().optional(),
  }).optional(),
  bnccStatus: z.enum(['mapeado', 'nao_mapeado']),
  bnccSummary: z.string().nullable().optional(),
  // Snapshot da fonte oficial e do planejamento usado na geração. Mantido no
  // JSONB da prova para que a revisão continue explicável após o currículo mudar.
  bnccDetails: z.array(z.object({
    code: z.string(),
    description: z.string(),
    context: z.array(z.string()),
    source: z.string(),
    dataVersion: z.string(),
    record: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
  curriculumSnapshot: z.object({
    unitTitle: z.string(),
    content: z.string().nullable(),
    enrichedContent: z.string().nullable(),
    objectives: z.array(z.string()),
  }).nullable().optional(),
  difficultyAssessment: z.object({
    source: z.enum(['provider', 'cache', 'fallback']),
    model: z.string(),
    confidence: z.number().min(0).max(1).nullable(),
    classifiedAt: z.string(),
  }).optional(),
  generationContext: z.object({
    educationContext: z.string(),
    subject: z.string(),
    bimester: z.number().int().nullable(),
    alternativesCount: z.number().int().nonnegative(),
    visualAid: z.enum(['auto', 'obrigatorio', 'sem_imagem']),
    targetDifficulty: z.enum(['facil', 'media', 'dificil']).nullable(),
  }).optional(),
  pedagogicalClassification: pedagogicalClassificationSchema,
  // Habilidade ENEM definida pelo planejamento (C:H), escolhida por código na
  // geração. Fica separada de inepAssessment/saeb, que o Jev reclassifica pelo
  // que a questão de fato exige; a divergência aparece para o revisor.
  plannedEnemSkill: z.object({ code: z.string(), description: z.string().nullable() }).nullable().optional(),
  planningAlignment: z.object({
    status: z.enum(['aligned', 'partial', 'misaligned', 'unavailable']),
    evidence: z.string(),
    model: z.string(),
    checkedAt: z.string(),
  }).optional(),
  saeb: z.object({
    applicable: z.boolean(),
    // .optional() além de .nullable(): o DeepSeek (sem responseSchema
    // aplicado no servidor, diferente do Gemini) às vezes omite a chave
    // inteira em vez de mandar null explícito quando julga "não aplicável"
    // — .nullable() sozinho rejeita chave ausente com "Required".
    source: z.enum(['novo_saeb', 'classica', 'enem']).nullable().optional(),
    value: z.string().nullable().optional(),
    approximate: z.boolean().optional().default(false),
  }).default({ applicable: false, source: null, value: null, approximate: false }),
  needsImage: z.boolean().optional().default(false),
  imageQuery: z.string().nullable().optional(),
  // Contrato emitido pela geração de prova inteira. `needsImage` e
  // `imageQuery` permanecem como aliases compatíveis com os fluxos existentes.
  hasImage: z.boolean().optional(),
  imageDescription: z.string().nullable().optional(),
  whatIfImage: z.string().nullable().optional(),
  // Plano visual produzido pelo estágio automático. Mantém o motivo, o
  // renderer e os parâmetros para que a imagem possa ser refeita sem nova IA.
  visualPlan: z.object({
    decision: z.enum(['recommended', 'not_needed', 'missing_required_visual', 'ai_optional']),
    required: z.boolean(),
    purpose: z.enum(['nenhum', 'interpretar_dados', 'representar_relacao', 'localizar_elemento', 'comparar_elementos', 'identificar_estrutura', 'analisar_documento', 'apoiar_contexto']).optional(),
    visualType: z.enum(['none', 'blank_coordinate_plane', 'coordinate_plane', 'function_graph', 'statistical_chart', 'geometric_diagram', 'chemical_structure', 'map', 'timeline', 'flowchart', 'phylogeny', 'historical_document', 'illustration']).optional(),
    renderer: z.string().nullable(),
    parameters: z.record(z.unknown()).nullable(),
    rationale: z.string(),
  }).nullable().optional(),
  // Filled after generation by questionImageService — never by Gemini
  // itself, and never trusted until a human approves it (see
  // examValidator's hard-reset of this block for ineligible subjects).
  image: z
    .object({
      source: z.enum(['busca', 'gerada', 'grafico', 'diagrama', 'quimica', 'importado', 'enem']),
      driveFileId: z.string(),
      previewUrl: z.string(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      approved: z.boolean(),
      originalBankMedia: z.boolean().optional(),
      // Só preenchido pra source:'importado' — link original colado pelo
      // professor, mantido pra referência/crédito da fonte.
      sourceUrl: z.string().nullable().optional(),
      // Registro do gerador determinístico usado. É preservado junto da
      // questão para que a origem técnica do visual seja auditável.
      provenance: z.object({
        mode: z.enum(['deterministic', 'ai']),
        generator: z.string(),
        generatorVersion: z.string(),
      }).optional(),
    })
    .nullable()
    .optional(),
  imageHistory: z.array(z.object({
    source: z.enum(['busca', 'gerada', 'grafico', 'diagrama', 'quimica', 'importado', 'enem']),
    originalBankMedia: z.boolean().optional(),
    width: z.number().positive().optional(), height: z.number().positive().optional(),
    driveFileId: z.string(), previewUrl: z.string(), approved: z.boolean(), sourceUrl: z.string().nullable().optional(),
    provenance: z.object({ mode: z.enum(['deterministic', 'ai']), generator: z.string(), generatorVersion: z.string() }).optional(),
    replacedAt: z.string(),
    changedBy: z.string().email().optional(),
  })).optional(),
  visualReview: z.object({
    status: z.enum(['complete', 'pending']),
    reason: z.string().optional(),
  }).optional(),
  imageAuditLog: z.array(z.object({
    action: z.enum(['generated', 'replaced', 'approved', 'unapproved', 'removed', 'restored']),
    at: z.string(), actor: z.string().email(), driveFileId: z.string().nullable(),
  })).optional(),
  // Anotação do professor revisor — nunca preenchida pela IA, só pela tela
  // /revisar. adequacy e difficulty são escalas independentes (uma questão
  // pode ser "adequada" em conteúdo mas "muito difícil" em nível, por
  // exemplo) — ver /revisar/RevisarExam.tsx.
  review: z
    .object({
      adequacy: z.enum(['adequada', 'inadequada']).nullable().optional(),
      difficulty: z.enum(['facil', 'adequada', 'dificil']).nullable().optional(),
      comment: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
})

export const examGenerationResultSchema = z.object({
  metadata: z.object({
    generationEngine: z.enum(['whole-exam-v1']).optional(),
    creationMode: z.enum(['automatic', 'manual']).optional(),
    questionSource: z.enum(['acervo', 'ia']).optional(),
    acervoHistory: z.array(z.object({ key: z.string(), statement: z.string(), questionId: z.number().int().positive().safe().optional() })).optional(),
    segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']),
    gradeYear: z.number().int(),
    academicYear: z.number().int().optional(),
    subject: z.string(),
    classLabel: z.string().optional(),
    bimester: z.number().int().nullable().optional(),
    questionCount: z.number().int(),
    objectiveCount: z.number().int(),
    discursiveCount: z.number().int(),
    alternativesCount: z.number().int(),
    // Planejamento interno usado como currículo (ausente = planilha).
    curriculumPlanId: z.number().int().positive().optional(),
    curriculumPlanVersionId: z.number().int().positive().optional(),
    // Geração parcial mantém o que foi aprovado, com as posições pendentes
    // explicitadas. Uma prova formal só segue ao fluxo quando o responsável
    // completa as posições ou confirma que aceita menos questões.
    generationProgress: z.object({
      complete: z.boolean(),
      requestedQuestionCount: z.number().int().nonnegative(),
      pendingQuestionNumbers: z.array(z.number().int().positive()),
      pendingReasons: z.record(z.string(), z.string()).optional(),
      acceptedReducedQuestionCount: z.boolean().optional().default(false),
    }).optional(),
    qualityTest: z.object({
      version: z.string(), checkedAt: z.string(), repairedQuestionNumbers: z.array(z.number().int()), warnings: z.array(z.string()),
      reports: z.array(z.object({ phase: z.string(), results: z.array(z.object({ questionNumber: z.number().int(), questionFingerprint: z.string().optional(), approved: z.boolean(), auditStatus: z.enum(['jev_audited', 'jev_unavailable', 'corrected_without_reaudit', 'correction_unavailable', 'official_bank_verified', 'official_bank_invalid']).optional(), verdictReason: z.string().optional(), checks: z.array(z.object({ criterion: z.string(), status: z.enum(['aprovado', 'reprovado', 'não_aplicável']), evidence: z.string() })).optional(), answerKeyAudit: z.object({ declaredLetter: z.string().nullable(), independentlyDerivedLetter: z.string().nullable(), matchesDeclared: z.boolean(), evidence: z.string() }).nullable().optional(), issues: z.array(z.object({ severity: z.enum(['bloqueante', 'alerta']), reason: z.string() })), diagnostics: z.array(qualityDiagnosticSchema).optional() })) })).optional(),
    }).optional(),
    difficultyClassification: z.object({
      version: z.string(),
      source: z.enum(['provider', 'cache', 'fallback']),
      model: z.string(),
      classifiedAt: z.string(),
      distribution: z.object({
        facil: z.number().int().nonnegative(),
        media: z.number().int().nonnegative(),
        dificil: z.number().int().nonnegative(),
        facilPercent: z.number().min(0).max(100),
        mediaPercent: z.number().min(0).max(100),
        dificilPercent: z.number().min(0).max(100),
      }),
      weightBasis: z.enum(['difficulty_normalized_to_100']),
    }).optional(),
    imageGeneration: z.object({
      status: z.enum(['pending', 'complete', 'partial']),
      jobId: z.number().int().positive().nullable(),
      pendingQuestionNumbers: z.array(z.number().int().positive()),
      updatedAt: z.string(),
    }).optional(),
  }),
  questions: z.array(examQuestionSchema),
})

export type ExamQuestion = z.infer<typeof examQuestionSchema>
export type ExamGenerationResult = z.infer<typeof examGenerationResultSchema>

// Usado por /api/exams/[examId]/regenerate-question — troca só UMA questão
// em vez de regenerar a prova inteira. Reaproveita examQuestionSchema (mesma
// forma de item de `questions[]`), só muda o envelope.
export const singleQuestionResultSchema = z.object({ question: examQuestionSchema })
export type SingleQuestionResult = z.infer<typeof singleQuestionResultSchema>

// Gemini's `responseSchema` accepts an OpenAPI-3.0-ish subset (no `z` here —
// hand-authored to mirror the zod shape above 1:1). Passed via the REST
// generationConfig field, no SDK required.
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    metadata: {
      type: 'object',
      properties: {
        segment: { type: 'string', enum: ['anos-iniciais', 'anos-finais', 'ensino-medio'] },
        gradeYear: { type: 'integer' },
        subject: { type: 'string' },
        classLabel: { type: 'string' },
        bimester: { type: 'integer', nullable: true },
        questionCount: { type: 'integer' },
        objectiveCount: { type: 'integer' },
        discursiveCount: { type: 'integer' },
        alternativesCount: { type: 'integer' },
      },
      required: ['segment', 'gradeYear', 'subject', 'questionCount', 'objectiveCount', 'discursiveCount', 'alternativesCount'],
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'integer' },
          curriculumUnitRowIndex: { type: 'integer', nullable: true, description: 'rowIndex do capítulo do planejamento usado pela questão; obrigatório quando houver matriz da avaliação.' },
          type: { type: 'string', enum: ['objetiva', 'descritiva'] },
          weight: { type: 'number', minimum: 0.1, maximum: 100 },
          bloomLevel: { type: 'string', enum: [...BLOOM_LEVELS] },
          statement: { type: 'string' },
          supportText: { type: 'string', nullable: true },
          alternatives: {
            type: 'array',
            nullable: true,
            items: {
              type: 'object',
              properties: { letter: { type: 'string' }, text: { type: 'string' } },
              required: ['letter', 'text'],
            },
          },
          correctLetter: { type: 'string', nullable: true },
          expectedAnswer: { type: 'string', nullable: true, description: 'OBRIGATÓRIO para type "descritiva": resposta esperada completa e concreta (uma parte por item a/b/c). null só em objetivas.' },
          gradingCriteria: { type: 'string', nullable: true, description: 'OBRIGATÓRIO para type "descritiva": critérios objetivos de correção em itens. null só em objetivas.' },
          solutionBlueprint: {
            type: 'object', nullable: true,
            properties: {
              domain: { type: 'string', enum: ['linear_system', 'rectangular_prism_volume', 'average_speed', 'percentage', 'ratio_proportion', 'simple_interest', 'compound_interest', 'arithmetic_progression', 'geometric_progression', 'linear_recurrence', 'linear_recurrence_order2', 'linear_function', 'quadratic_function', 'point_distance', 'circle_relative_position', 'sphere_point_position', 'kinematics_uniform', 'kinematics_accelerated', 'newton_second_law', 'weight_force', 'kinetic_energy', 'ohms_law', 'electric_power', 'density', 'mole_calculation', 'molar_concentration', 'solution_dilution', 'other'] },
              variables: { type: 'array', items: { type: 'object', properties: { symbol: { type: 'string' }, meaning: { type: 'string' } }, required: ['symbol', 'meaning'] } },
              equations: { type: 'array', items: { type: 'string' } },
              values: { type: 'object', additionalProperties: { type: 'number' } },
              calculationSteps: { type: 'array', items: { type: 'string' } },
              derivedAnswer: { type: 'string' },
              visualSpec: { type: 'string', enum: ['none', 'blank_coordinate_plane', 'coordinate_plane', 'chart'] },
            },
            required: ['domain', 'variables', 'equations', 'values', 'calculationSteps', 'derivedAnswer', 'visualSpec'],
          },
          bnccCodes: { type: 'array', items: { type: 'string' } },
          bnccStatus: { type: 'string', enum: ['mapeado', 'nao_mapeado'] },
          bnccSummary: { type: 'string', nullable: true, description: 'Resumo curto (uma frase) da habilidade testada, para a coluna "Habilidade" do Mapa da prova.' },
          pedagogicalClassification: {
            type: 'object',
            properties: {
              dok: {
                type: 'object',
                properties: {
                  categoryCode: { type: 'string', enum: [...DOK_LEVELS] },
                  confidence: { type: 'number', minimum: 0, maximum: 1 },
                  justification: { type: 'string' },
                  evidence: { type: 'string' },
                },
                required: ['categoryCode', 'confidence', 'justification', 'evidence'],
              },
              soloExpected: {
                type: 'object',
                properties: {
                  categoryCode: { type: 'string', enum: [...SOLO_EXPECTED_LEVELS] },
                  confidence: { type: 'number', minimum: 0, maximum: 1 },
                  justification: { type: 'string' },
                  evidence: { type: 'string' },
                },
                required: ['categoryCode', 'confidence', 'justification', 'evidence'],
              },
              estimatedTimeMinutes: { type: 'number', nullable: true },
              difficulty: { type: 'string', enum: ['facil', 'media', 'dificil'], nullable: true },
            },
            required: ['dok', 'soloExpected'],
          },
          needsImage: { type: 'boolean', description: 'true se uma imagem de apoio (diagrama, mapa, foto, ilustração) tornaria a questão mais clara ou pedagogicamente melhor.' },
          imageQuery: { type: 'string', nullable: true, description: 'Quando needsImage=true: uma consulta de busca curta e específica em português para encontrar/gerar a imagem (ex: "célula animal diagrama partes", "mapa político da Europa 1945", "ciclo da água ilustração"). null quando needsImage=false.' },
          saeb: {
            type: 'object',
            properties: {
              applicable: { type: 'boolean' },
              source: { type: 'string', enum: ['novo_saeb', 'classica', 'enem'], nullable: true },
              value: { type: 'string', nullable: true },
              approximate: { type: 'boolean' },
            },
            required: ['applicable', 'approximate'],
          },
        },
        required: ['number', 'type', 'weight', 'bloomLevel', 'statement', 'bnccCodes', 'bnccStatus', 'pedagogicalClassification', 'saeb', 'needsImage', 'alternatives', 'correctLetter', 'solutionBlueprint'],
      },
    },
  },
  required: ['metadata', 'questions'],
}

// Mesmo shape de item de GEMINI_RESPONSE_SCHEMA.questions, só envelopado
// como { question } em vez de { questions: [...] } — pra pedir exatamente
// 1 questão de substituição em vez da prova inteira.
export const SINGLE_QUESTION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    question: GEMINI_RESPONSE_SCHEMA.properties.questions.items,
  },
  required: ['question'],
}
