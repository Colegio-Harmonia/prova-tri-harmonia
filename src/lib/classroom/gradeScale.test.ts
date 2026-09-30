import { describe, expect, it } from 'vitest'
import { CLASSROOM_MAX_POINTS, gradeOnClassroomScale } from './gradeScale'

describe('gradeOnClassroomScale', () => {
  it('converte a nota interna de 0–10 para 0–100', () => {
    expect(CLASSROOM_MAX_POINTS).toBe(100)
    expect(gradeOnClassroomScale(5)).toBe(50)
    expect(gradeOnClassroomScale(7.5)).toBe(75)
  })

  it('mantém a nota dentro da escala permitida', () => {
    expect(gradeOnClassroomScale(-1)).toBe(0)
    expect(gradeOnClassroomScale(12)).toBe(100)
  })
})
