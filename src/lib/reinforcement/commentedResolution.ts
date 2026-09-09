import { z } from 'zod'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { generateValidatedStructuredContent } from '@/lib/gemini/structuredRepair'

// Gabarito Comentado do reforço ENEM (Módulo 3): resolução passo a passo
// por questão, com foco pedagógico na habilidade INEP trabalhada. Gerada
// pelo DeepSeek DEPOIS da seleção (questão real do banco nunca é editada —
// a resolução é conteúdo adicional, não alteração da questão).
// Concorrência máxima 2, mesmo teto das sugestões de nota (custo de IA).

const resolutionSchema = z.object({
  commentedResolution: z.string().min(60),
})

const RESOLUTION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: { commentedResolution: { type: 'string' } },
  required: ['commentedResolution'],
} as const

const CONCURRENCY = 2

function buildResolutionPrompt(question: ExamQuestion, skillLabel: string | null): string {
  const alternatives = (question.alternatives ?? []).map((a) => `${a.letter}) ${a.text}`).join('\n')
  return `Você é um professor de Ensino Médio preparando o GABARITO COMENTADO de uma atividade de reforço para o ENEM.

Questão real do ENEM${question.enemBankRef ? ` (${question.enemBankRef.year})` : ''}:
${question.supportText ? `Texto de apoio:\n${question.supportText}\n\n` : ''}Enunciado: ${question.statement}
Alternativas:
${alternatives}
Alternativa correta: ${question.correctLetter}
${skillLabel ? `Habilidade INEP trabalhada: ${skillLabel}` : ''}

Escreva a resolução comentada em português do Brasil, no formato:
1. Resolução passo a passo do raciocínio até a alternativa correta (${question.correctLetter}), explicitando a habilidade que o passo exercita.
2. Por que cada alternativa incorreta é errada — o erro de raciocínio típico que leva o aluno a marcá-la.
3. Uma dica curta de estudo pra quem errou (1-2 frases, ligada à habilidade).

Regras: não invente dados que não estão na questão; não mude a questão nem o gabarito; linguagem direta de professor pra aluno; use markdown simples (negrito e listas).

Responda APENAS em JSON: {"commentedResolution": "<texto em markdown>"}`
}

export async function generateCommentedResolutions(
  questions: ExamQuestion[],
): Promise<{ resolutions: Map<number, string>; warnings: string[] }> {
  const resolutions = new Map<number, string>()
  const warnings: string[] = []
  const objective = questions.filter((q) => q.type === 'objetiva' && q.correctLetter)

  for (let i = 0; i < objective.length; i += CONCURRENCY) {
    const batch = objective.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (question) => {
        try {
          const result = await generateValidatedStructuredContent<z.infer<typeof resolutionSchema>, z.infer<typeof resolutionSchema>>({
            context: 'reinforcement/commented-resolution',
            prompt: buildResolutionPrompt(question, question.saeb.value ?? null),
            responseSchema: RESOLUTION_RESPONSE_SCHEMA,
            zodSchema: resolutionSchema,
          })
          resolutions.set(question.number, result.value.commentedResolution)
        } catch (err) {
          // Falha por questão nunca derruba a atividade — o gabarito dessa
          // questão sai só com a letra, e o aviso fica registrado.
          console.warn(`[reinforcement] falha na resolução comentada da questão ${question.number}:`, err instanceof Error ? err.message : err)
          warnings.push(`Questão ${question.number}: resolução comentada não pôde ser gerada — gabarito sai só com a alternativa correta.`)
        }
      }),
    )
  }

  return { resolutions, warnings }
}
