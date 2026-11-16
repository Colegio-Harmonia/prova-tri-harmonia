import { describe, expect, it, vi } from 'vitest'

vi.mock('@/db/client', () => ({ db: {} }))
const { pickCurrentAcademicYear } = await import('./prerequisiteService')

const row = (planId: number, academicYear: number, bimester: number, status: string, versionNumber = 1) => ({ planId, academicYear, bimester, status, versionNumber })

describe('pickCurrentAcademicYear', () => {
  it('planejamento de ano futuro não muda o ano vigente', () => {
    expect(pickCurrentAcademicYear([row(1, 2026, 4, 'aprovado'), row(2, 2027, 4, 'aprovado')])).toBe(2026)
  })
  it('encerrar o 4º bimestre encerra o ano', () => {
    expect(pickCurrentAcademicYear([row(1, 2026, 4, 'encerrado'), row(2, 2026, 4, 'encerrado'), row(3, 2027, 1, 'rascunho')])).toBe(2027)
    expect(pickCurrentAcademicYear([row(1, 2026, 4, 'encerrado')])).toBe(2027)
  })
  it('basta um 4º bimestre aberto para o ano continuar vigente', () => {
    expect(pickCurrentAcademicYear([row(1, 2026, 4, 'encerrado'), row(2, 2026, 4, 'aprovado'), row(3, 2027, 4, 'aprovado')])).toBe(2026)
  })
  it('vale a versão oficial: rascunho novo de um planejamento encerrado não reabre o ano', () => {
    expect(pickCurrentAcademicYear([row(1, 2026, 4, 'encerrado', 1), row(1, 2026, 4, 'rascunho', 2), row(2, 2027, 1, 'aprovado')])).toBe(2027)
  })
  it('ano sem 4º bimestre planejado continua vigente', () => {
    expect(pickCurrentAcademicYear([row(1, 2026, 1, 'aprovado'), row(2, 2027, 4, 'aprovado')])).toBe(2026)
  })
  it('sem planejamento, vale o ano civil', () => {
    expect(pickCurrentAcademicYear([], 2031)).toBe(2031)
  })
})
