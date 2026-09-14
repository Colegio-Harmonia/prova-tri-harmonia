import { describe, expect, it } from 'vitest'
import { currentBimester } from './currentBimester'

describe('currentBimester', () => {
  it('mapeia os meses para os quatro bimestres do calendário letivo', () => {
    expect(currentBimester(new Date(2026, 0, 15))).toBe(1)
    expect(currentBimester(new Date(2026, 2, 10))).toBe(1)
    expect(currentBimester(new Date(2026, 3, 30))).toBe(1)
    expect(currentBimester(new Date(2026, 4, 1))).toBe(2)
    expect(currentBimester(new Date(2026, 6, 20))).toBe(2)
    expect(currentBimester(new Date(2026, 7, 1))).toBe(3)
    expect(currentBimester(new Date(2026, 8, 30))).toBe(3)
    expect(currentBimester(new Date(2026, 9, 1))).toBe(4)
    expect(currentBimester(new Date(2026, 11, 31))).toBe(4)
  })
})
