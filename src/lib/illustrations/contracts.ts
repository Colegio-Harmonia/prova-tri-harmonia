import { z } from 'zod'

export const functionGraphSchema = z.object({
  expression: z.string().trim().min(1).max(240),
  domain: z.tuple([z.number().finite(), z.number().finite()]).refine(([min, max]) => min < max, 'Domínio inválido.'),
  range: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  showGrid: z.boolean().default(true),
  showAxes: z.boolean().default(true),
})

export type FunctionGraphSpec = z.infer<typeof functionGraphSchema>

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
  render: (input: TInput) => RenderedIllustration | Promise<RenderedIllustration>
}
