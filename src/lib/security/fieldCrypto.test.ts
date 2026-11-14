import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { blindIndex, decryptField, encryptField, fieldEncryptionEnabled, FieldCryptoError, isEncryptedValue, plainIndex, resetFieldCryptoCache } from './fieldCrypto'

const KEY_A = Buffer.alloc(32, 7).toString('base64')
const KEY_B = Buffer.alloc(32, 9).toString('base64')
const original = process.env.STUDENT_DATA_KEY

function useKey(key: string | undefined) {
  if (key === undefined) delete process.env.STUDENT_DATA_KEY
  else process.env.STUDENT_DATA_KEY = key
  resetFieldCryptoCache()
}

afterEach(() => useKey(original))

describe('sem chave configurada', () => {
  beforeEach(() => useKey(undefined))

  it('grava e lê em texto puro, e o índice é o SHA-256 simples (o mesmo da migration)', () => {
    expect(fieldEncryptionEnabled()).toBe(false)
    expect(encryptField('Maria Silva')).toBe('Maria Silva')
    expect(decryptField('Maria Silva')).toBe('Maria Silva')
    expect(blindIndex('Maria Silva')).toBe(plainIndex('Maria Silva'))
    expect(plainIndex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('recusa ler dado cifrado em vez de devolver lixo', () => {
    useKey(KEY_A)
    const stored = encryptField('Maria Silva')
    useKey(undefined)
    expect(() => decryptField(stored)).toThrow(FieldCryptoError)
  })
})

describe('com chave', () => {
  beforeEach(() => useKey(KEY_A))

  it('cifra com IV aleatório e decifra de volta, inclusive acentos e texto vazio', () => {
    const a = encryptField('João Antônio Ñandú')
    const b = encryptField('João Antônio Ñandú')
    expect(isEncryptedValue(a)).toBe(true)
    expect(a).not.toBe(b)
    expect(a).not.toContain('João')
    expect(decryptField(a)).toBe('João Antônio Ñandú')
    expect(decryptField(b)).toBe('João Antônio Ñandú')
    expect(decryptField(encryptField(''))).toBe('')
  })

  it('não cifra duas vezes e continua lendo texto puro legado', () => {
    const once = encryptField('Ana')
    expect(encryptField(once)).toBe(once)
    expect(decryptField('Ana')).toBe('Ana')
  })

  it('índice cego é estável, depende da chave e não é o SHA-256 simples', () => {
    const index = blindIndex('Maria Silva')
    expect(index).toMatch(/^[0-9a-f]{64}$/)
    expect(blindIndex('Maria Silva')).toBe(index)
    expect(index).not.toBe(plainIndex('Maria Silva'))
    expect(blindIndex('maria silva')).not.toBe(index)
    useKey(KEY_B)
    expect(blindIndex('Maria Silva')).not.toBe(index)
  })

  it('chave errada ou valor adulterado lançam erro', () => {
    const stored = encryptField('Maria Silva')
    const tampered = stored.slice(0, -2) + (stored.endsWith('AA') ? 'BB' : 'AA')
    expect(() => decryptField(tampered)).toThrow(FieldCryptoError)
    expect(() => decryptField('enc:v1:abc')).toThrow(/corrompido/)
    useKey(KEY_B)
    expect(() => decryptField(stored)).toThrow(/chave configurada/)
  })

  it('rejeita chave de tamanho errado', () => {
    useKey(Buffer.alloc(16, 1).toString('base64'))
    expect(() => encryptField('x')).toThrow(/32 bytes/)
  })
})
