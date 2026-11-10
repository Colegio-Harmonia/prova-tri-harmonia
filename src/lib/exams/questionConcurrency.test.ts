import { describe, expect, it } from 'vitest'
import { mapInBatches } from './questionConcurrency'

describe('mapInBatches', () => {
  it('finishes one item at a time and preserves input order', async () => {
    let active = 0
    let maximum = 0
    const result = await mapInBatches([1, 2, 3, 4, 5, 6, 7], async (item) => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active--
      return item * 2
    })

    expect(maximum).toBe(1)
    expect(result).toEqual([2, 4, 6, 8, 10, 12, 14])
  })
})
