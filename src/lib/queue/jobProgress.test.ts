import { describe, expect, it } from 'vitest'
import { shouldRegenerateQuestionItem } from './jobProgress'

describe('shouldRegenerateQuestionItem', () => {
  it('reusa questão já produzida e tenta novamente só slots pendentes ou com erro', () => {
    expect(shouldRegenerateQuestionItem('gerando', true)).toBe(false)
    expect(shouldRegenerateQuestionItem('gerando', false)).toBe(true)
    expect(shouldRegenerateQuestionItem('erro', true)).toBe(true)
    expect(shouldRegenerateQuestionItem('pendente', true)).toBe(true)
    expect(shouldRegenerateQuestionItem('concluido', true)).toBe(false)
  })
})
