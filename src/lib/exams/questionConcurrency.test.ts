import { describe, expect, it } from 'vitest'
import { mapInBatches, QUESTION_GENERATION_CONCURRENCY } from './questionConcurrency'

describe('mapInBatches', () => {
  it('bounds concurrent questions and preserves input order', async () => {
    let active = 0
    let maximum = 0
    const result = await mapInBatches([1, 2, 3, 4, 5, 6, 7], async (item) => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active--
      return item * 2
    })

    expect(maximum).toBe(QUESTION_GENERATION_CONCURRENCY)
    expect(result).toEqual([2, 4, 6, 8, 10, 12, 14])
  })
})
