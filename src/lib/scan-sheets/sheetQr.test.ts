import { describe, expect, it } from 'vitest'
import { createPageQrPayload, createSheetTokenDigest, issuedSheetTokens, readSheetQrSigningKeys, SheetQrSigningConfigurationError, verifyPageQrPayload } from './sheetQr'

const secret = Buffer.alloc(32, 7).toString('base64url')

describe('QR assinado das folhas', () => {
  it('emite um token opaco por página e o valida com a chave configurada', () => {
    const [key] = readSheetQrSigningKeys(`jul-2026=${secret}`)
    const token = createPageQrPayload({ publicId: 'QwErTyUiOpAsDfGhJkLzXcVb', pageNumber: 2, layoutVersion: 'PTR1' }, key)

    expect(token).toMatch(/^PTR1\.QwErTyUiOpAsDfGhJkLzXcVb\.2\.PTR1\.jul-2026\./)
    expect(token).not.toContain('Ana')
    expect(verifyPageQrPayload(token, [key])).toEqual({
      publicId: 'QwErTyUiOpAsDfGhJkLzXcVb',
      pageNumber: 2,
      layoutVersion: 'PTR1',
      keyId: 'jul-2026',
    })
  })

  it('rejeita mudança de um caractere e mantém digest sem revelar os tokens', () => {
    const [key] = readSheetQrSigningKeys(`jul-2026=${secret}`)
    const token1 = createPageQrPayload({ publicId: 'QwErTyUiOpAsDfGhJkLzXcVb', pageNumber: 1, layoutVersion: 'PTR1' }, key)
    const token2 = createPageQrPayload({ publicId: 'QwErTyUiOpAsDfGhJkLzXcVb', pageNumber: 2, layoutVersion: 'PTR1' }, key)
    const altered = `${token1.slice(0, -1)}${token1.endsWith('A') ? 'B' : 'A'}`

    expect(verifyPageQrPayload(altered, [key])).toBeNull()
    const digest = createSheetTokenDigest([token1, token2])
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    expect(digest).not.toContain(token1)
  })

  it('exige segredo forte e formato explícito de rotação', () => {
    expect(() => readSheetQrSigningKeys('jul-2026=curto')).toThrow(SheetQrSigningConfigurationError)
    expect(() => readSheetQrSigningKeys('jul 2026=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toThrow(SheetQrSigningConfigurationError)
    expect(() => readSheetQrSigningKeys()).toThrow(SheetQrSigningConfigurationError)
  })

  it('recria os QR de um cartão emitido com a chave original após rotação', () => {
    const oldSecret = Buffer.alloc(32, 7).toString('base64url')
    const newSecret = Buffer.alloc(32, 8).toString('base64url')
    const [oldKey] = readSheetQrSigningKeys(`jul-2026=${oldSecret}`)
    const original = [
      createPageQrPayload({ publicId: 'QwErTyUiOpAsDfGhJkLzXcVb', pageNumber: 1, layoutVersion: 'PTR1' }, oldKey),
      createPageQrPayload({ publicId: 'QwErTyUiOpAsDfGhJkLzXcVb', pageNumber: 2, layoutVersion: 'PTR1' }, oldKey),
    ]
    const rotatedKeys = readSheetQrSigningKeys(`ago-2026=${newSecret},jul-2026=${oldSecret}`)

    expect(issuedSheetTokens({
      publicId: 'QwErTyUiOpAsDfGhJkLzXcVb',
      pageCount: 2,
      layoutVersion: 'PTR1',
      tokenDigest: createSheetTokenDigest(original),
      signingKeys: rotatedKeys,
    })).toEqual(original)
  })
})
