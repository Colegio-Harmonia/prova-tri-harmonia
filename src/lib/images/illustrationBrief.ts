import { z } from 'zod'
import { generateStructuredContent } from '@/lib/gemini/llmClient'

const responseSchema = {
  type: 'object',
  properties: { whatIfImage: { type: 'string' } },
  required: ['whatIfImage'],
}

const briefSchema = z.object({ whatIfImage: z.string().min(8).max(400) })

/**
 * Cria um briefing visual que nunca é exibido como parte da questão. Ele
 * evita transformar enunciado, fórmula ou resposta em instrução de imagem.
 */
export async function generateIllustrationBrief(params: { subject: string; statement: string; supportText?: string | null }) {
  const raw = await generateStructuredContent(`Crie um briefing curto para uma possível ilustração didática de uma questão de ${params.subject}.

Questão: ${params.statement}
${params.supportText ? `Texto de apoio: ${params.supportText}` : ''}

Descreva apenas cenário, objetos e relações visuais neutras, como "uma foto de um retângulo ao lado de um triângulo". Não inclua números, fórmula, resultado, gabarito, alternativa correta, texto instrucional, legenda ou qualquer elemento que revele a resposta. Responda somente com whatIfImage.`, responseSchema, 'images/generate-brief')
  return briefSchema.parse(raw).whatIfImage
}
