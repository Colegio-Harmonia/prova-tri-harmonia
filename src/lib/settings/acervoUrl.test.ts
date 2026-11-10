import { describe, expect, it } from 'vitest'
import { acervoUrlSchema } from './acervoUrl'

describe('endereço do acervo', () => {
  it.each([
    [' 192.168.1.100:5000 ', 'http://192.168.1.100:5000'],
    ['https://acervo.escola.com.br/', 'https://acervo.escola.com.br'],
    ['http://[::1]:5000', 'http://[::1]:5000'],
  ])('normaliza %s', (input, expected) => expect(acervoUrlSchema.parse(input)).toBe(expected))

  it.each(['', 'http://', 'ftp://acervo.local', 'https://user:pass@acervo.local', 'http://acervo.local/api/v1', 'http://acervo.local?key=x', 'http://acervo.local#x'])
    ('rejeita endereço inválido: %s', (input) => expect(acervoUrlSchema.safeParse(input).success).toBe(false))
})
