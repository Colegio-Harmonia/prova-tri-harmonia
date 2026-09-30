import { z, type ZodType } from 'zod'

export const functionGraphSchema = z.object({
  expression: z.string().trim().min(1).max(240),
  domain: z.tuple([z.number().finite(), z.number().finite()]).refine(([min, max]) => min < max, 'Domínio inválido.'),
  range: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  showGrid: z.boolean().default(true),
  showAxes: z.boolean().default(true),
})

export type FunctionGraphSpec = z.infer<typeof functionGraphSchema>

export const coordinatePlaneSchema = z.object({
  points: z.array(z.object({
    label: z.string().trim().min(1).max(12),
    x: z.number().finite().min(-100).max(100),
    y: z.number().finite().min(-100).max(100),
  })).min(1).max(20),
  segments: z.array(z.object({ from: z.string().trim().min(1).max(12), to: z.string().trim().min(1).max(12) })).max(30).default([]),
}).superRefine((spec, context) => {
  const labels = new Set(spec.points.map((point) => point.label))
  if (labels.size !== spec.points.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Os rótulos dos pontos precisam ser únicos.' })
  for (const segment of spec.segments) {
    if (!labels.has(segment.from) || !labels.has(segment.to)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Todo segmento precisa apontar para pontos existentes.' })
    }
  }
})

export type CoordinatePlaneSpec = z.infer<typeof coordinatePlaneSchema>

export const blankCoordinatePlaneSchema = z.object({
  axisRange: z.number().finite().int().min(5).max(100).default(10),
})
export type BlankCoordinatePlaneSpec = z.infer<typeof blankCoordinatePlaneSchema>

export type IllustrationProvenance = {
  mode: 'deterministic' | 'ai'
  generator: string
  generatorVersion: string
}

export type RenderedIllustration = {
  mimeType: 'image/svg+xml' | 'image/png'
  content: Buffer
  provenance: IllustrationProvenance
}

export type IllustrationGenerator<TInput = unknown> = {
  id: string
  title: string
  subject: 'matematica' | 'geografia' | 'historia' | 'biologia' | 'quimica' | 'fisica'
  /** Contrato usado para filtrar sugestões da IA antes de exibi-las ao professor. */
  parametersSchema: ZodType<TInput, z.ZodTypeDef, unknown>
  render: (input: TInput) => RenderedIllustration | Promise<RenderedIllustration>
}
