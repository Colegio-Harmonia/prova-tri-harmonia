import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { classifyDiscursiveOcrResult, cropDiscursiveAnswer, discursiveCropGeometry, discursiveProviderFailure } from './discursiveOcr'

describe('recortes PTR1 de respostas discursivas', () => {
  it('inclui os quadros inteiros com margem, sem misturar questões', () => {
    const first = discursiveCropGeometry(0, 3)
    const second = discursiveCropGeometry(1, 3)
    const third = discursiveCropGeometry(2, 3)

    expect(first.left).toBeGreaterThan(0)
    expect(first.top).toBeGreaterThan(0)
    expect(first.left + first.width).toBeLessThanOrEqual(2100)
    expect(third.top + third.height).toBeLessThanOrEqual(2970)
    expect(first.top + first.height).toBeLessThan(second.top)
    expect(second.top + second.height).toBeLessThan(third.top)
    expect(first).toEqual({ left: 90, top: 970, width: 1920, height: 504 })
    expect(third.top + third.height).toBeGreaterThanOrEqual(2500)
    expect(third.top + third.height).toBeLessThanOrEqual(2501)
  })

  it.each([1, 2, 3])('preserva tinta nas quatro bordas de cada um dos %i quadros impressos em diferentes resoluções', async (count) => {
    for (const size of [{ width: 2100, height: 2970 }, { width: 1241, height: 1754 }]) {
      const sx = size.width / 210
      const sy = size.height / 297
      const printedHeight = (147 - 7 * (count - 1)) / count
      for (let index = 0; index < count; index++) {
        const printedTop = 100 + index * (printedHeight + 7)
        // Marcas junto às bordas do quadro real, incluindo acima da primeira
        // linha e abaixo da última linha. O recorte antigo as descartava.
        const points = [
          { left: Math.ceil(12 * sx), top: Math.ceil(printedTop * sy) },
          { left: Math.floor(198 * sx) - 3, top: Math.ceil(printedTop * sy) },
          { left: Math.ceil(12 * sx), top: Math.floor((printedTop + printedHeight) * sy) - 3 },
          { left: Math.floor(198 * sx) - 3, top: Math.floor((printedTop + printedHeight) * sy) - 3 },
          { left: Math.ceil(10 * sx), top: Math.ceil((printedTop - 2) * sy) },
          { left: Math.floor(200 * sx) - 3, top: Math.floor((printedTop + printedHeight + 2) * sy) - 3 },
        ]
        const ink = await sharp({ create: { width: 3, height: 3, channels: 3, background: 'black' } }).png().toBuffer()
        const canonicalImage = await sharp({ create: { ...size, channels: 3, background: 'white' } })
          .composite(points.map((point) => ({ ...point, input: ink }))).png().toBuffer()
        const crop = await cropDiscursiveAnswer({ canonicalImage, questionIndex: index, questionsOnPage: count })
        const geometry = discursiveCropGeometry(index, count, size)
        const { data, info } = await sharp(crop).removeAlpha().raw().toBuffer({ resolveWithObject: true })
        for (const point of points) {
          const x = point.left + 1 - geometry.left
          const y = point.top + 1 - geometry.top
          expect(x).toBeGreaterThanOrEqual(0)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThan(info.width)
          expect(y).toBeLessThan(info.height)
          expect(data[(y * info.width + x) * info.channels]).toBeLessThan(80)
        }
      }
    }
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
