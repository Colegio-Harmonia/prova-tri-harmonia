import { describe, expect, it } from 'vitest'
import type { CorrectionAnswer } from '@/types/correction'
import { buildInternalEstimate } from './internalEstimate'

function answer(questionNumber: number, isCorrect: boolean): CorrectionAnswer {
  return {
    questionNumber,
    type: 'objetiva',
    transcribedAnswer: isCorrect ? 'A' : 'B',
    correctLetter: 'A',
    isCorrect,
    aiSuggestedGrade: null,
    aiSuggestedFeedback: null,
    finalGrade: isCorrect ? 10 : 0,
    finalFeedback: null,
  }
}

describe('buildInternalEstimate', () => {
  it('usa somente itens autorais/IA e os pesos pedagógicos declarados', () => {
    const estimate = buildInternalEstimate(
      [answer(1, true), answer(2, false), answer(3, true)],
      [
        { number: 1, source: 'ia', difficulty: 'facil' },
        { number: 2, source: 'ia', difficulty: 'dificil' },
        { number: 3, source: 'enem_bank', difficulty: 'media' },
      ],
    )

    expect(estimate).toEqual({
      percent: 45,
      itemsUsed: 2,
      incompleteAnswers: 0,
      method: 'editorial_difficulty_weighted',
    })
  })

  it('não produz indicador quando a prova só tem itens ENEM', () => {
    expect(buildInternalEstimate([answer(1, true)], [{ number: 1, source: 'enem_bank' }])).toBeNull()
  })
})
