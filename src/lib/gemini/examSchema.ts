import { z } from 'zod'

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

export const examQuestionSchema = z.object({
  number: z.number().int(),
  // Vínculo opcional com a linha do planejamento escolar. Provas antigas
  // continuam válidas; novas provas com matriz preenchem este campo.
  curriculumUnitRowIndex: z.number().int().nullable().optional(),
  // 'ia' = gerada pelo Gemini (padrão). 'enem_bank' = questão real de uma
  // prova passada do ENEM, escolhida manualmente pela coordenação na tela
  // de geração — nunca regenerada, nunca editada pela IA.
  source: z.enum(['ia', 'enem_bank']).default('ia'),
  enemBankRef: z.object({ questionId: z.number().int(), year: z.number().int() }).nullable().optional(),
  type: z.enum(['objetiva', 'descritiva']),
  // Valor máximo em pontos. Pode ser ajustado pelo professor na revisão
  // antes da aplicação; a correção guarda uma cópia para não mudar o
  // histórico caso a prova seja editada depois.
  weight: z.number().positive().max(100).optional(),
  bloomLevel: z.enum(BLOOM_LEVELS),
  statement: z.string(),
  supportText: z.string().nullable().optional(),
  alternatives: z.array(z.object({ letter: z.string(), text: z.string() })).nullable().optional(),
  correctLetter: z.string().nullable().optional(),
  expectedAnswer: z.string().nullable().optional(),
  gradingCriteria: z.string().nullable().optional(),
  // Resolução passo a passo com foco pedagógico (Módulo 3 — atividade de
  // reforço ENEM): gerada pelo DeepSeek DEPOIS da seleção das questões do
  // banco, nunca pela geração de prova comum. Vai pro documento "Gabarito
  // Comentado" da atividade.
  commentedResolution: z.string().nullable().optional(),
  bnccCodes: z.array(z.string()),
  bnccStatus: z.enum(['mapeado', 'nao_mapeado']),
  bnccSummary: z.string().nullable().optional(),
  pedagogicalClassification: pedagogicalClassificationSchema,
  saeb: z.object({
    applicable: z.boolean(),
    // .optional() além de .nullable(): o DeepSeek (sem responseSchema
    // aplicado no servidor, diferente do Gemini) às vezes omite a chave
    // inteira em vez de mandar null explícito quando julga "não aplicável"
    // — .nullable() sozinho rejeita chave ausente com "Required".
    source: z.enum(['novo_saeb', 'classica', 'enem']).nullable().optional(),
    value: z.string().nullable().optional(),
    approximate: z.boolean().optional().default(false),
  }),
  needsImage: z.boolean().optional().default(false),
  imageQuery: z.string().nullable().optional(),
  // Filled after generation by questionImageService — never by Gemini
  // itself, and never trusted until a human approves it (see
  // examValidator's hard-reset of this block for ineligible subjects).
  image: z
    .object({
      source: z.enum(['busca', 'gerada', 'grafico', 'importado', 'enem']),
      driveFileId: z.string(),
      previewUrl: z.string(),
      approved: z.boolean(),
      // Só preenchido pra source:'importado' — link original colado pelo
      // professor, mantido pra referência/crédito da fonte.
      sourceUrl: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
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
    segment: z.enum(['anos-iniciais', 'anos-finais', 'ensino-medio']),
    gradeYear: z.number().int(),
    subject: z.string(),
    bimester: z.number().int().nullable().optional(),
    questionCount: z.number().int(),
    objectiveCount: z.number().int(),
    discursiveCount: z.number().int(),
    alternativesCount: z.number().int(),
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
          expectedAnswer: { type: 'string', nullable: true },
          gradingCriteria: { type: 'string', nullable: true },
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
        required: ['number', 'type', 'weight', 'bloomLevel', 'statement', 'bnccCodes', 'bnccStatus', 'pedagogicalClassification', 'saeb', 'needsImage', 'alternatives', 'correctLetter'],
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
