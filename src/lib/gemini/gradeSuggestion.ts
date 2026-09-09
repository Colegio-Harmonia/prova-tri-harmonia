import { z } from 'zod'
import { prepareStudentAnswerForAi } from '@/lib/ai/promptSafety'
import { generateValidatedStructuredContent } from './structuredRepair'

const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    grade: { type: 'number', description: 'Nota de 0 a 10, pode usar até 1 casa decimal.' },
    feedback: { type: 'string', description: 'Justificativa curta (2-4 frases) explicando a nota, em português, direcionada ao professor.' },
  },
  required: ['grade', 'feedback'],
}

const suggestionResultSchema = z.object({
  grade: z.number().min(0).max(10),
  feedback: z.string(),
})

export type GradeSuggestion = z.infer<typeof suggestionResultSchema>

/**
 * Sugestão de nota pra 1 questão descritiva — nunca autoritativa, sempre
 * editável pelo professor antes de virar nota final (mesmo princípio já
 * seguido em todo o projeto: a IA nunca decide sozinha, só sugere).
 */
export async function suggestGrade(params: {
  statement: string
  expectedAnswer: string | null
  gradingCriteria: string | null
  studentAnswer: string
}): Promise<GradeSuggestion> {
  const { statement, expectedAnswer, gradingCriteria, studentAnswer } = params
  const safeStudentAnswer = prepareStudentAnswerForAi(studentAnswer)

  const prompt = `Você é um professor corrigindo uma questão descritiva. Avalie a resposta do aluno e sugira uma nota de 0 a 10.

Enunciado da questão:
"""
${statement}
"""

${expectedAnswer ? `Resposta esperada (referência):\n"""\n${expectedAnswer}\n"""\n\n` : ''}${gradingCriteria ? `Critérios de correção:\n"""\n${gradingCriteria}\n"""\n\n` : ''}Resposta do aluno (transcrita):
"""
${safeStudentAnswer || '(em branco)'}
"""

Avalie com justiça: dê crédito parcial por respostas parcialmente corretas, não exija texto idêntico à resposta esperada, considere o mérito do raciocínio. Se a resposta estiver em branco, a nota é 0.`

  const result = await generateValidatedStructuredContent({
    context: 'grade-suggestion',
    prompt,
    responseSchema: SUGGESTION_SCHEMA,
    zodSchema: suggestionResultSchema,
  })
  return result.value
}
