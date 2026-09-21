import { z } from 'zod'
import { prepareStudentAnswerForAi } from '@/lib/ai/promptSafety'
import { normalizeAiGrade } from '@/lib/corrections/gradeNormalization'
import { generateValidatedStructuredContent } from './structuredRepair'

const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    grade: { type: 'number', description: 'Nota numérica na escala indicada no enunciado da correção.' },
    feedback: { type: 'string', description: 'Justificativa curta (2-4 frases) explicando a nota, em português, direcionada ao professor.' },
  },
  required: ['grade', 'feedback'],
}

const suggestionResultSchema = z.object({
  grade: z.number().min(0).max(10),
  feedback: z.string(),
})

export type GradeSuggestion = {
  /** Nota literal do modelo, preservada para diagnóstico. */
  rawGrade: number
  /** Nota já normalizada para o máximo da questão. */
  grade: number
  sourceScale: 'question' | '0-10'
  feedback: string
}

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
  maxGrade: number
}): Promise<GradeSuggestion> {
  const { statement, expectedAnswer, gradingCriteria, studentAnswer, maxGrade } = params
  const safeStudentAnswer = prepareStudentAnswerForAi(studentAnswer)

  const prompt = `Você é um professor corrigindo uma questão descritiva. Avalie a resposta do aluno na escala oficial desta questão.

VALOR MÁXIMO DA QUESTÃO: ${maxGrade.toFixed(2)} ponto(s).
Retorne o campo "grade" obrigatoriamente entre 0 e ${maxGrade.toFixed(2)}, inclusive. Não use a escala genérica de 0 a 10, exceto quando o máximo desta questão for 10.

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
  const normalized = normalizeAiGrade(result.value.grade, maxGrade)
  return { ...normalized, feedback: result.value.feedback }
}
