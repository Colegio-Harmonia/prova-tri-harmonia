import { describe, expect, it } from 'vitest'
import { normalizeBlueprintNumber, parseResponseJson } from './responseJson'

describe('parseResponseJson', () => {
  it('preserva uma resposta válida, inclusive escapes e vírgulas em texto', () => {
    const value = { text: 'A, } B, ]\nC "D" \\ E', values: [1, 2] }
    expect(parseResponseJson(JSON.stringify(value))).toEqual({ value, repaired: false })
  })
  it('recupera cercas, controles literais, escapes inválidos e vírgulas finais sem alterar o texto', () => {
    const response = '```json\n{"statement":"Linha 1\nLinha 2 \\sqrt{4}","alternatives":["A, ]",],}\n```'
    expect(parseResponseJson(response)).toEqual({ value: { statement: 'Linha 1\nLinha 2 \\sqrt{4}', alternatives: ['A, ]'] }, repaired: true })
  })
  it.each(['{"questions":[{"statement":"incompleta', '{"questions":[1,2', 'Resposta: {"questions":[]}', "{'answer':'A'}"])(
    'não inventa conteúdo nem fecha resposta truncada: %s', (text) => {
      expect(() => parseResponseJson(text)).toThrow()
    },
  )
})

describe('normalizeBlueprintNumber', () => {
  it.each([['12', 12], [' -0.25 ', -0.25], ['1e3', 1000], [0, 0]])('normaliza apenas número decimal inequívoco %s', (value, expected) => {
    expect(normalizeBlueprintNumber(value)).toBe(expected)
  })
  it.each(['1/2', '2 cm', '1,5', '1.000,50', '', 'Infinity', '1e999', null, true])('preserva valores que exigem interpretação: %s', (value) => {
    expect(normalizeBlueprintNumber(value)).toBe(value)
  })
})
