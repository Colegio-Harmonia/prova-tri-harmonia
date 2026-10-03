import { describe, expect, it } from 'vitest'
import { detectAlternativeAmbiguities } from './alternatives'
import { comparableNumber } from './domains'
import { parseNumberToken, parseSingleNumber, sameNumber } from './similarity'

describe('parseSingleNumber', () => {
  it('lê o ponto como decimal quando não forma milhar (era 0.5 → 5, 2.5 → 25)', () => {
    expect(parseSingleNumber('0.5')).toBe(0.5)
    expect(parseSingleNumber('2.5')).toBe(2.5)
    expect(parseSingleNumber('0.04')).toBe(0.04)
    expect(parseSingleNumber('3.14159')).toBe(3.14159)
    expect(parseSingleNumber('x = 1.5 cm')).toBe(1.5)
    expect(parseSingleNumber('-0.75')).toBe(-0.75)
  })

  it('mantém o formato pt-BR: vírgula decimal e ponto de milhar', () => {
    expect(parseSingleNumber('2,50 m')).toBe(2.5)
    expect(parseSingleNumber('R$ 1.210,00')).toBe(1210)
    expect(parseSingleNumber('1.200')).toBe(1200)
    expect(parseSingleNumber('1.000.000')).toBe(1000000)
    expect(parseSingleNumber('x = 2,43')).toBe(2.43)
    expect(parseSingleNumber('-3')).toBe(-3)
  })

  it('"0.250" é decimal, nunca milhar', () => {
    expect(parseSingleNumber('0.250')).toBe(0.25)
  })

  it('devolve null para vários números ou token ambíguo', () => {
    expect(parseSingleNumber('a=2, b=-3')).toBeNull()
    expect(parseSingleNumber('(2; 3)')).toBeNull()
    expect(parseSingleNumber('1,2,3')).toBeNull()
    expect(parseSingleNumber('sem número')).toBeNull()
  })

  it('parseNumberToken respeita o sinal', () => {
    expect(parseNumberToken('-1.210,5')).toBe(-1210.5)
  })
})

describe('sameNumber', () => {
  it('não confunde 0.5 com 5 nem 2.5 com 25', () => {
    expect(sameNumber('5', '0.5')).toBe(false)
    expect(sameNumber('25', '2.5')).toBe(false)
    expect(sameNumber('4', '0.04')).toBe(false)
  })

  it('reconhece o mesmo valor em grafias diferentes (antes "2,5" e "2.5" passavam como distintos)', () => {
    expect(sameNumber('2,5', '2.5')).toBe(true)
    expect(sameNumber('2,50', '2,5')).toBe(true)
    expect(sameNumber('1.200', '1200')).toBe(true)
  })
})

describe('comparableNumber', () => {
  it('usa a mesma leitura do primeiro número', () => {
    expect(comparableNumber('2.5')).toBe(2.5)
    expect(comparableNumber('f(4) = 9')).toBe(4)
    expect(comparableNumber('1.234,5')).toBe(1234.5)
    expect(comparableNumber('sem número')).toBeNull()
  })
})

describe('detectAlternativeAmbiguities com ponto decimal', () => {
  it('distrator "0.5" não é mais tratado como igual à resposta "5"', () => {
    const issues = detectAlternativeAmbiguities([{ letter: 'R', text: '5' }, { letter: 'B', text: '0.5' }, { letter: 'C', text: '50' }])
    expect(issues).toEqual([])
  })

  it('"2,5" e "2.5" são o mesmo valor e continuam sinalizados', () => {
    const issues = detectAlternativeAmbiguities([{ letter: 'A', text: '2,5' }, { letter: 'B', text: '2.5' }])
    expect(issues).toHaveLength(1)
    expect(issues[0].reason).toContain('mesmo valor numérico')
  })
})
