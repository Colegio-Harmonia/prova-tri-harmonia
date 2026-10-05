import { describe, expect, it } from 'vitest'

import { shouldBoldCommandVerbs, splitCommandVerbs } from './commandVerbs'

const boldOf = (text: string, opts = {}) => splitCommandVerbs(text, opts).filter((s) => s.bold).map((s) => s.text)
const rejoin = (text: string) => splitCommandVerbs(text).map((s) => s.text).join('')

describe('splitCommandVerbs', () => {
  it('negrita só os verbos de comando e preserva o texto exato', () => {
    const text = 'Leia o texto e responda. a) Explique por que o gelo derrete. b) Cite dois exemplos.'
    expect(boldOf(text)).toEqual(['Leia', 'responda', 'Explique', 'Cite'])
    expect(rejoin(text)).toBe(text)
  })

  it('não confunde substantivo com verbo (acento é preservado)', () => {
    expect(boldOf('Segundo a análise do autor, qual foi a escolha feita?')).toEqual([])
    expect(boldOf('Analise a escolha do autor.')).toEqual(['Analise'])
  })

  it('verbos ambíguos só em início de frase', () => {
    expect(boldOf('Escolha a alternativa correta.')).toEqual(['Escolha'])
    expect(boldOf('A escolha do prefeito foi criticada.')).toEqual([])
  })

  it('não casa dentro de outras palavras', () => {
    expect(boldOf('O citeriano usou o útil.')).toEqual([])
  })

  it('inglês só quando solicitado e só em início de frase', () => {
    expect(boldOf('Read the text. Then, answer the questions.')).toEqual([])
    expect(boldOf('Read the text. Then, answer the questions.', { includeEnglish: true })).toEqual(['Read'])
    expect(boldOf('Read the text. Answer the questions.', { includeEnglish: true })).toEqual(['Read', 'Answer'])
  })

  it('retorna vazio para texto vazio', () => {
    expect(splitCommandVerbs('')).toEqual([])
  })
})

describe('shouldBoldCommandVerbs', () => {
  it('só Fundamental 1 e 2', () => {
    expect(shouldBoldCommandVerbs('anos-iniciais')).toBe(true)
    expect(shouldBoldCommandVerbs('anos-finais')).toBe(true)
    expect(shouldBoldCommandVerbs('ensino-medio')).toBe(false)
  })
})
