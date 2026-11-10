import { describe, expect, it } from 'vitest'
import { hasLatexSegments, isRenderableMath, splitLatexSegments, stripLatexDelimiters } from './latexRender'
import { normalizeMathText } from './mathTextIntegrity'
import katex from 'katex'

describe('renderização matemática', () => {
  it('não encerra uma fórmula no cifrão escapado da moeda', () => {
    const text = String.raw`O saldo é $S_0 = \text{R\$} 160.000,00$. Os juros são $J_1 = \text{R\$} 8.000,00$. Fim da resposta.`
    const parts = splitLatexSegments(text)
    expect(parts.filter((p) => p.type === 'math').map((p) => p.latex)).toEqual([
      String.raw`S_0 = \text{R\$} 160.000,00`, String.raw`J_1 = \text{R\$} 8.000,00`,
    ])
    expect(parts.at(-1)).toEqual({ type: 'text', content: '. Fim da resposta.' })
    for (const p of parts) if (p.type === 'math') expect(() => katex.renderToString(p.latex, { throwOnError: true })).not.toThrow()
    expect(normalizeMathText(normalizeMathText(text))).toBe(normalizeMathText(text))
  })
  it('mantém sincronizados expoentes após cos e sen sem interpretar a frase como fórmula', () => {
    const text = 'cos$^{8}$ x - sen$^{8}$ x + 4 sen$^{6}$ x = a. Das afirmações:'
    const parts = splitLatexSegments(text)
    expect(parts.filter((p) => p.type === 'math').map((p) => p.latex)).toEqual(['^{8}', '^{8}', '^{6}'])
    expect(stripLatexDelimiters(text)).toBe('cos^{8} x - sen^{8} x + 4 sen^{6} x = a. Das afirmações:')
  })
  it.each([String.raw`HCO$_{3}^{-}$$_{(aq)}$`, String.raw`HCO$_{3}$$^{-}$$_{(aq)}$`])('corrige também o estado físico após reunir subscritos separados: %s', (text) => {
    const parts = splitLatexSegments(text)
    expect(parts).toEqual([{ type: 'math', latex: 'HCO_{3}^{-}{}_{(aq)}', display: false }])
  })
  it.each([String.raw`HCO_{3}^{-}_{(aq)}`, String.raw`H_{2}CO_{3}_{(aq)}`])
    ('preserva o estado físico sem subscrito duplo da fonte: %s', (formula) => {
      const text = `$${formula}$`
      const parts = splitLatexSegments(text)
      expect(parts).toHaveLength(1)
      const part = parts[0]!
      expect(part.type).toBe('math')
      if (part.type !== 'math') return
      expect(part.latex).toBe(formula.replace('_{(aq)}', '{}_{(aq)}'))
      expect(() => katex.renderToString(part.latex, { throwOnError: true })).not.toThrow()
      expect(normalizeMathText(normalizeMathText(text))).toBe(normalizeMathText(text))
    })
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

describe('notação recebida do acervo sem delimitadores', () => {
  it('reconhece dados químicos, número de Avogadro e unidades como fórmulas completas', () => {
    const text = String.raw`Dados: Massas molares atômicas: \text{H} = 1\text{ g/mol} ; \text{C} = 12\text{ g/mol} ; Constante de Avogadro: N_A = 6{,}0 \times 10^{23}\text{ mol}^{-1} . Com base nos dados, calcule a massa.`
    const parts = splitLatexSegments(text)
    expect(parts.filter((p) => p.type === 'math').map((p) => p.latex)).toEqual([
      String.raw`\text{H} = 1\text{ g/mol}`, String.raw`\text{C} = 12\text{ g/mol}`, String.raw`N_A = 6{,}0 \times 10^{23}\text{ mol}^{-1}`,
    ])
    expect(parts.filter((p) => p.type === 'text').map((p) => p.content).join('')).toContain('Com base nos dados, calcule a massa.')
  })
  it('não converte palavras com underscore nem texto comum em fórmulas', () => {
    expect(hasLatexSegments('arquivo_original e massa de três metabólitos, R$ 30,00')).toBe(false)
  })
})
