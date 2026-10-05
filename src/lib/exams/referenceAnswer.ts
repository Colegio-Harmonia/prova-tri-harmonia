import type { ExamQuestion } from '@/lib/gemini/examSchema'

/**
 * Toda questão descritiva PRECISA ter resposta esperada cadastrada: ela é a
 * base da correção (gabarito do professor e nota sugerida por IA). Sem ela a
 * IA corrige "no escuro" e dois professores corrigem a mesma questão de
 * formas diferentes. Regra aplicada na geração (validador), na troca de
 * questão, na conclusão/aprovação da prova e na sugestão de nota.
 */
export const MIN_REFERENCE_ANSWER_LENGTH = 15

type QuestionLike = Pick<ExamQuestion, 'number' | 'type' | 'expectedAnswer'>

export function hasReferenceAnswer(question: Pick<ExamQuestion, 'expectedAnswer'>): boolean {
  return (question.expectedAnswer ?? '').trim().length >= MIN_REFERENCE_ANSWER_LENGTH
}

/** Números das descritivas sem resposta esperada utilizável. */
export function findDiscursiveWithoutReferenceAnswer(questions: QuestionLike[]): number[] {
  return questions.filter((q) => q.type === 'descritiva' && !hasReferenceAnswer(q)).map((q) => q.number)
}

export function referenceAnswerMissingMessage(numbers: number[]): string {
  const list = numbers.join(', ')
  return numbers.length === 1
    ? `A questão descritiva ${list} está sem resposta esperada cadastrada. Use "Trocar só essa questão" para regenerá-la antes de seguir.`
    : `As questões descritivas ${list} estão sem resposta esperada cadastrada. Use "Trocar só essa questão" para regenerá-las antes de seguir.`
}
