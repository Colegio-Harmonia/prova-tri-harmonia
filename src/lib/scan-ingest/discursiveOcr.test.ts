import { describe, expect, it } from 'vitest'
import { classifyDiscursiveOcrResult, discursiveCropGeometry, discursiveProviderFailure } from './discursiveOcr'

describe('recortes PTR1 de respostas discursivas', () => {
  it('gera áreas internas ordenadas sem invadir a página', () => {
    const first = discursiveCropGeometry(0, 3)
    const second = discursiveCropGeometry(1, 3)
    const third = discursiveCropGeometry(2, 3)

    expect(first.left).toBeGreaterThan(0)
    expect(first.top).toBeGreaterThan(0)
    expect(first.left + first.width).toBeLessThanOrEqual(2100)
    expect(third.top + third.height).toBeLessThanOrEqual(2970)
    expect(first.top + first.height).toBeLessThan(second.top)
    expect(second.top + second.height).toBeLessThan(third.top)
  })

  it('rejeita índices e tamanhos fora do layout PTR1', () => {
    expect(() => discursiveCropGeometry(3, 3)).toThrow('Índice')
    expect(() => discursiveCropGeometry(0, 4)).toThrow('Quantidade')
  })

  it('explica quando o modelo configurado deixou de estar disponível', () => {
    const failure = discursiveProviderFailure({ isAxiosError: true, response: { status: 404 } }, 'gemini-2.5-flash')

    expect(failure?.failureCode).toBe('provider_model_not_available')
    expect(failure?.message).toContain('gemini-2.5-flash')
  })
  it('explica quando os creditos do provedor estao esgotados', () => {
    const failure = discursiveProviderFailure({ isAxiosError: true, response: { status: 402 } }, 'gemini-3.6-flash')

    expect(failure?.failureCode).toBe('provider_credits_exhausted')
    expect(failure?.message).toContain('créditos')
  })

  it('classifica uma resposta sem escrita como sem resposta', () => {
    expect(classifyDiscursiveOcrResult({ transcription: '', legible: true, blank: true })).toEqual({ blank: true, legible: false })
    expect(classifyDiscursiveOcrResult({ transcription: '', legible: true })).toEqual({ blank: true, legible: false })
  })

  it('mantém escrita ilegível como pendência de revisão', () => {
    expect(classifyDiscursiveOcrResult({ transcription: '', legible: false, blank: false })).toEqual({ blank: false, legible: false })
  })
})
