import { z } from 'zod'

// Contrato de saída do motor de adaptação (spec 6.4). Validado por Zod
// dentro do structuredRepair; a equivalência pedagógica é validada à
// parte (equivalenceValidator) — este schema só garante o shape.

export const adaptedQuestionSchema = z.object({
  number: z.number().int(),
  adaptedStatement: z.string().min(1),
  adaptedSupportText: z.string().nullable().optional(),
  adaptedAlternatives: z
    .array(z.object({ letter: z.string().min(1), text: z.string() }))
    .nullable()
    .optional(),
  formulaSupport: z.string().nullable().optional(),
  visualSupportSuggestion: z.string().nullable().optional(),
  imageDescription: z.string().nullable().optional(),
  removedElements: z.array(z.string()).optional().default([]),
  adaptationNotes: z.string().min(1),
  harmonizationNotes: z.string().nullable().optional(),
})

export type AdaptedQuestion = z.infer<typeof adaptedQuestionSchema>

export const adaptationResultSchema = z.object({
  questions: z.array(adaptedQuestionSchema).min(1),
})

export type AdaptationResult = z.infer<typeof adaptationResultSchema>

// Schema JSON pro provedor (mesmo papel do GEMINI_RESPONSE_SCHEMA da
// geração de prova).
export const ADAPTATION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'integer' },
          adaptedStatement: { type: 'string' },
          adaptedSupportText: { type: 'string', nullable: true },
          adaptedAlternatives: {
            type: 'array',
            nullable: true,
            items: {
              type: 'object',
              properties: { letter: { type: 'string' }, text: { type: 'string' } },
              required: ['letter', 'text'],
            },
          },
          formulaSupport: { type: 'string', nullable: true },
          visualSupportSuggestion: { type: 'string', nullable: true },
          imageDescription: { type: 'string', nullable: true },
          removedElements: { type: 'array', items: { type: 'string' } },
          adaptationNotes: { type: 'string' },
          harmonizationNotes: { type: 'string', nullable: true },
        },
        required: ['number', 'adaptedStatement', 'adaptationNotes'],
      },
    },
  },
  required: ['questions'],
} as const
