import React from 'react'
import { PassThrough } from 'node:stream'
import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { LazyMathText } from './LazyMathText'

describe('carregamento sob demanda de fórmulas', () => {
  it('entrega texto sem fórmulas sem aguardar o renderizador', () => {
    const fragment = JSDOM.fragment(renderToStaticMarkup(<LazyMathText text="Texto do professor." />))
    expect(fragment.textContent).toBe('Texto do professor.')
    expect(fragment.querySelector('[aria-busy]')).toBeNull()
  })

  it('preserva a fórmula e o texto após carregar o renderizador', async () => {
    const html = await new Promise<string>((resolve, reject) => {
      const output = new PassThrough()
      let result = ''
      output.on('data', (chunk) => { result += chunk.toString() })
      output.on('end', () => resolve(result))
      const stream = renderToPipeableStream(<LazyMathText text={String.raw`Calcule $\frac{1}{2}$ do total.`} />, {
        onAllReady() { stream.pipe(output) }, onError: reject,
      })
    })
    const fragment = JSDOM.fragment(html)
    expect(fragment.querySelectorAll('.katex')).toHaveLength(1)
    expect(fragment.querySelector('annotation')?.textContent).toBe(String.raw`\frac{1}{2}`)
    expect(fragment.textContent).toContain('Calcule ')
    expect(fragment.textContent).toContain(' do total.')
    expect(fragment.querySelector('[aria-busy]')).toBeNull()
  })
})
