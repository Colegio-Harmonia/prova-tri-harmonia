import { z } from 'zod'

const exceptionCode = z.string().trim().min(1).max(80).nullable().optional()

const readingSchema = z.object({
  questionNumber: z.number().int().positive().max(200),
  kind: z.enum(['objective', 'discursive']),
  suggestedLetter: z.enum(['A', 'B', 'C', 'D', 'E']).nullable().optional(),
  suggestedTranscription: z.string().max(20_000).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  exceptionCode,
  modelReference: z.string().trim().min(1).max(120).nullable().optional(),
}).strict().superRefine((reading, context) => {
  if (reading.kind === 'objective' && reading.suggestedTranscription) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Leitura objetiva não aceita transcrição.' })
  }
  if (reading.kind === 'discursive' && reading.suggestedLetter) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Leitura discursiva não aceita letra sugerida.' })
  }
})

const pageSchema = z.object({
  pageIndex: z.number().int().positive().max(500),
  qrToken: z.string().min(1).max(256).nullable().optional(),
  pageType: z.enum(['objective', 'discursive', 'unknown']),
  qualityScore: z.number().min(0).max(1).nullable().optional(),
  exceptionCode,
  readings: z.array(readingSchema).max(200),
}).strict().superRefine((page, context) => {
  const numbers = page.readings.map((reading) => reading.questionNumber)
  if (new Set(numbers).size !== numbers.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Questão repetida na mesma página.' })
  }
})

export const workerScanResultSchema = z.object({
  uploadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.array(pageSchema).min(1).max(500),
}).strict().superRefine((result, context) => {
  const indexes = result.pages.map((page) => page.pageIndex)
  if (new Set(indexes).size !== indexes.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Página repetida no resultado.' })
  }
})

export type WorkerScanResult = z.infer<typeof workerScanResultSchema>
