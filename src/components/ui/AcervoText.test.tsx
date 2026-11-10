import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { AcervoText } from './AcervoText'

describe('fórmulas do acervo em imagem', () => {
  it('não sobrepõe a edição local do professor com a apresentação antiga', () => {
    const html = renderToStaticMarkup(React.createElement(AcervoText, { examId: 489, text: 'Enunciado revisado.', parts: [{ type: 'text', text: 'Enunciado antigo.' }, { type: 'image', mediaId: 10, alt: 'Fórmula antiga' }] }))
    const fragment = JSDOM.fragment(html)
    expect(fragment.querySelector('img')).toBeNull()
    expect(fragment.textContent).toBe('Enunciado revisado.')
  })
  it('insere a fração entre as palavras e usa o endereço autorizado da prova', () => {
    const html = renderToStaticMarkup(React.createElement(AcervoText, { examId: 489, text: 'Gasta do salário', parts: [
      { type: 'text', text: 'Gasta ' }, { type: 'image', mediaId: 1000000284782, alt: 'Fração', width: 13 }, { type: 'text', text: ' do salário' },
    ] }))
    const fragment = JSDOM.fragment(html)
    const image = fragment.querySelector('img')!
    expect(image.getAttribute('src')).toBe('/api/exams/489/acervo-media/1000000284782')
    expect(image.previousSibling?.textContent).toBe('Gasta ')
    expect(image.nextSibling?.textContent).toBe(' do salário')
    expect(image.getAttribute('style')).toContain('width:13px')
  })
})
