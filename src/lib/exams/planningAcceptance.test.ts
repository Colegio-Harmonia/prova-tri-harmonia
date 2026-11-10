import { describe, expect, it, vi } from 'vitest'
vi.mock('@/db/client', () => ({ db: {} }))
import { createPlanningAcceptance, PlanningAlignmentUnavailableError } from './planningAlignment'

const alignment = (status: 'aligned' | 'partial' | 'misaligned' | 'unavailable') => ({
  status, evidence: status === 'unavailable' ? 'Conferência de aderência indisponível; nenhuma compatibilidade foi presumida.' : 'x', model: 'jev', checkedAt: new Date().toISOString(),
})

describe('aceitação de candidato do acervo pela conferência de aderência', () => {
  it('aceita só aligned', () => {
    const accept = createPlanningAcceptance()
    expect(accept(alignment('aligned'))).toBe(true)
    expect(accept(alignment('partial'))).toBe(false)
    expect(accept(alignment('misaligned'))).toBe(false)
  })

  it('descarta o candidato quando a conferência fica indisponível, sem derrubar a prova', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const accept = createPlanningAcceptance(2)
    expect(accept(alignment('unavailable'))).toBe(false)
    expect(accept(alignment('unavailable'))).toBe(false)
    expect(accept(alignment('aligned'))).toBe(true)
  })

  it('interrompe quando a indisponibilidade passa do limite (provedor fora)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const accept = createPlanningAcceptance(2)
    accept(alignment('unavailable'))
    accept(alignment('unavailable'))
    expect(() => accept(alignment('unavailable'))).toThrow(PlanningAlignmentUnavailableError)
  })
})
