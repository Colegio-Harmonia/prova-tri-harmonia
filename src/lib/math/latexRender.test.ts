import { describe, expect, it } from 'vitest'
import { hasLatexSegments, isRenderableMath, splitLatexSegments, stripLatexDelimiters } from './latexRender'
import { normalizeMathText } from './mathTextIntegrity'

describe('renderização matemática', () => {
  it('reconhece delimitadores em linha e em bloco', () => {
    const parts = splitLatexSegments('A: $x^2$ e $$\\frac{1}{2}$$ e \\(y\\).')
    expect(parts.filter((part) => part.type === 'math')).toHaveLength(3)
    expect(parts.find((part) => part.type === 'math' && part.display)).toBeTruthy()
  })

  it('não trata moeda como fórmula', () => {
    expect(hasLatexSegments('Custa R$ 30,00.')).toBe(false)
    expect(hasLatexSegments('R$ 30,00 e R$ 50,00')).toBe(false)
  })

  it('reconhece fórmula com número antes do delimitador', () => {
    const parts = splitLatexSegments('vendeu 2$\\frac{3}{4}$ litros de suco')
    expect(parts.find((part) => part.type === 'math')).toEqual({ type: 'math', latex: '\\frac{3}{4}', display: false })
    expect(parts.some((part) => part.type === 'text' && part.content.includes('litros de suco'))).toBe(true)
  })

  it('protege comandos LaTeX deixados sem delimitadores', () => {
    expect(normalizeMathText('C(1,\\sqrt{8}) e \\frac{3\\sqrt{3}}{2}')).toBe('C(1,$\\sqrt{8}$) e $\\frac{3\\sqrt{3}}{2}$')
  })

  it('troca thickspace pela forma compatível com o renderer', () => {
    expect(normalizeMathText('$t \\thickspace \\text{aproximadamente} \\thickspace 7$'))
      .toBe('$t \\; \\text{aproximadamente} \\; 7$')
  })

  it('recupera comandos que o parser JSON converteu em TAB', () => {
    expect(normalizeMathText('$100 \times 3^{0,2t}$ e $t \thickspace \text{aproximadamente} \thickspace 7$'))
      .toBe('$100 \\times 3^{0,2t}$ e $t \\; \\text{aproximadamente} \\; 7$')
  })

  it('não trata reticências de trecho omitido como fórmula', () => {
    expect(hasLatexSegments('Trecho: \\[…\\] fim')).toBe(false)
    expect(splitLatexSegments('Trecho: \\[…\\] fim').every((part) => part.type === 'text')).toBe(true)
    expect(stripLatexDelimiters('Antes \\[…\\] depois')).toBe('Antes […] depois')
    expect(isRenderableMath('…')).toBe(false)
    expect(isRenderableMath('...')).toBe(false)
    expect(isRenderableMath('\\frac{1}{2}')).toBe(true)
  })

  it('normalizeMathText preserva a omissão como texto, sem virar fórmula', () => {
    expect(normalizeMathText('Trecho \\[…\\] omitido')).toBe('Trecho […] omitido')
    expect(normalizeMathText('Omissão \\(...\\) no meio')).toBe('Omissão (...) no meio')
  })

  it('reagrupa fórmula molecular fatiada pelo gerador em um único segmento', () => {
    const parts = splitLatexSegments('fórmula molecular C$_4$H$_8$O, mas diferem')
    const math = parts.filter((part) => part.type === 'math')
    expect(math).toHaveLength(1)
    expect(math[0]).toMatchObject({ type: 'math', latex: 'C_4H_8O' })
    expect(stripLatexDelimiters('fórmula C$_4$H$_8$O, mas')).toBe('fórmula C_4H_8O, mas')
  })

  it('não mexe em siglas nem em moeda', () => {
    expect(splitLatexSegments('ENEM e SOLO custam R$ 30,00').every((part) => part.type === 'text')).toBe(true)
  })
})
