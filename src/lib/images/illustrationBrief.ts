import { z } from 'zod'
import { generateStructuredContent } from '@/lib/gemini/llmClient'

const responseSchema = {
  type: 'object',
  properties: { whatIfImage: { type: 'string' } },
  required: ['whatIfImage'],
}

const briefSchema = z.object({ whatIfImage: z.string().trim().min(8) })

/** O provedor pode ignorar o limite pedido; isso não deve impedir a imagem. */
export function compactIllustrationBrief(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= 400) return compact
  const prefix = compact.slice(0, 400)
  return prefix.slice(0, prefix.lastIndexOf(' ')).trimEnd() || prefix
}

/**
 * Cria um briefing visual que nunca é exibido como parte da questão. Ele
 * evita transformar enunciado, fórmula ou resposta em instrução de imagem.
 */
export async function generateIllustrationBrief(params: { subject: string; statement: string; supportText?: string | null }) {
  const raw = await generateStructuredContent(`Crie um briefing curto para uma possível ilustração didática de uma questão de ${params.subject}.

Questão: ${params.statement}
${params.supportText ? `Texto de apoio: ${params.supportText}` : ''}

Descreva em até 300 caracteres apenas cenário, objetos e relações visuais neutras, como "uma foto de um retângulo ao lado de um triângulo". Não inclua números, fórmula, resultado, gabarito, alternativa correta, texto instrucional, legenda ou qualquer elemento que revele a resposta. Responda somente com whatIfImage.`, responseSchema, 'images/generate-brief')
  return compactIllustrationBrief(briefSchema.parse(raw).whatIfImage)
}
