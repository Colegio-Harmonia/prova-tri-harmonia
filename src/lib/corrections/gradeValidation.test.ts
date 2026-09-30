import { describe, expect, it } from 'vitest'
import { missingGradeQuestionNumbers } from './gradeValidation'

describe('missingGradeQuestionNumbers', () => {
  it('finds ungraded objective and discursive answers but accepts zero as a grade', () => {
    expect(missingGradeQuestionNumbers([
      { questionNumber: 1, type: 'objetiva', isCorrect: true, finalGrade: 1 },
      { questionNumber: 2, type: 'objetiva', isCorrect: false, finalGrade: 0 },
      { questionNumber: 3, type: 'objetiva', isCorrect: null, finalGrade: null },
      { questionNumber: 4, type: 'descritiva', isCorrect: null, finalGrade: 0 },
      { questionNumber: 5, type: 'descritiva', isCorrect: null, finalGrade: null },
    ])).toEqual([3, 5])
  })
})
