import { describe, expect, it } from 'vitest'
import { splitBoldSegments } from '@/lib/text/markdownBold'

const plain = (text: string) => splitBoldSegments(text).map((s) => s.text).join('')
const bolds = (text: string) => splitBoldSegments(text).filter((s) => s.bold).map((s) => s.text)

// Regressão real: Prova Adaptada (TDAH), exam 649 — a IA devolve ênfase em
// Markdown e o Google Docs imprimia os asteriscos.
describe('splitBoldSegments', () => {
  it('converte **trecho** em negrito sem os asteriscos', () => {
    const text = '3) **Escreva** em inglês o adjetivo, oposto de "tall".'
    expect(plain(text)).toBe('3) Escreva em inglês o adjetivo, oposto de "tall".')
    expect(bolds(text)).toEqual(['Escreva'])
  })

  it('aceita quebra de linha simples, mas não atravessa parágrafo', () => {
    expect(bolds('**Leia o texto.\nDepois responda.**')).toEqual(['Leia o texto.\nDepois responda.'])
    expect(plain('**abre\n\nfecha**')).toBe('**abre\n\nfecha**')
  })

  it('preserva potência e ** sem par', () => {
    expect(plain('2**3 + 4**2')).toBe('2**3 + 4**2')
    expect(plain('Quanto vale 2 **3** 2?')).toBe('Quanto vale 2 **3** 2?')
    expect(plain('2 ** 3')).toBe('2 ** 3')
    expect(bolds('Marque **3** alternativas')).toEqual(['3'])
  })

  it('não interpreta ** dentro de código entre crases', () => {
    expect(plain('Use o literal `**texto**` e **destaque**')).toBe('Use o literal `**texto**` e destaque')
    expect(bolds('Use `**` e **destaque** aqui')).toEqual(['destaque'])
  })

  it('é null-safe', () => {
    expect(splitBoldSegments(null)).toEqual([])
    expect(splitBoldSegments('')).toEqual([])
  })
})
