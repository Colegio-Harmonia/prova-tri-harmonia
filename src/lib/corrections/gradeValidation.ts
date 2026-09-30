import type { CorrectionAnswer } from '@/types/correction'

/** Questions that still do not have a grade that can be persisted. */
export function missingGradeQuestionNumbers(answers: Pick<CorrectionAnswer, 'questionNumber' | 'type' | 'isCorrect' | 'finalGrade'>[]) {
  return answers
    .filter((answer) => answer.type === 'objetiva'
      ? answer.isCorrect === null || answer.finalGrade === null
      : answer.finalGrade === null)
    .map((answer) => answer.questionNumber)
}
