import { describe, expect, it } from 'vitest'
import { evenQuestionCounts } from './chapterDistribution'

describe('evenQuestionCounts', () => {
  it('distribui igualmente e joga o resto em ordem estável', () => {
    expect(evenQuestionCounts([1, 2, 3], 12)).toEqual({ 1: 4, 2: 4, 3: 4 })
    expect(evenQuestionCounts([1, 2, 3], 5)).toEqual({ 1: 2, 2: 2, 3: 1 })
    expect(evenQuestionCounts([], 12)).toEqual({})
  })
})
