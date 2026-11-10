import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { renderLatexPng } from './latexRenderServer'

describe('impressão local de símbolos', () => {
  it('renderiza fórmulas químicas e notação científica em PNG sem rede', async () => {
    const png = await renderLatexPng(String.raw`N_A = 6{,}0 \times 10^{23}\text{ mol}^{-1}`)
    const metadata = await sharp(png).metadata()
    expect(metadata.format).toBe('png')
    expect(metadata.width).toBeGreaterThan(100)
    expect(metadata.height).toBeGreaterThan(10)
  })
  it('não imprime mensagens de erro como se fossem uma fórmula', async () => {
    await expect(renderLatexPng(String.raw`\frac{`)).rejects.toThrow()
  })
})
