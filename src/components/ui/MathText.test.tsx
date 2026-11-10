import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { MathText } from './MathText'

describe('fórmulas na revisão', () => {
  it.each([String.raw`$\mathrm{Q}_{1}$`, String.raw`$T = 0,050 \times (60)^2 = 180\text{ N}$`, String.raw`$f'_1 = \frac{1}{2L}\sqrt{\frac{4T}{\mu}} = 40\text{ Hz}$`])
    ('renderiza a fórmula completa uma vez, sem caixa de rolagem em linha', (text) => {
      const fragment = JSDOM.fragment(renderToStaticMarkup(React.createElement(MathText, { text })))
      expect(fragment.querySelectorAll('.katex')).toHaveLength(1)
      expect(fragment.querySelector('.katex-error')).toBeNull()
      expect(fragment.firstElementChild?.className).not.toMatch(/overflow|inline-block/)
      expect(fragment.querySelector('annotation')?.textContent).toBe(text.slice(1, -1))
    })
})
