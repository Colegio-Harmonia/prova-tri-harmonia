import { createHash, createHmac, timingSafeEqual } from 'crypto'

const TOKEN_VERSION = 'PTR1'
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
const LAYOUT_PATTERN = /^[A-Za-z0-9_-]{2,32}$/

export type SheetQrSigningKey = {
  keyId: string
  key: Buffer
}

export type SheetQrPayload = {
  publicId: string
  pageNumber: number
  layoutVersion: string
  keyId: string
}

export class SheetQrSigningConfigurationError extends Error {
  constructor() {
    super('A chave de assinatura dos QR das folhas não está configurada.')
  }
}

function signingInput(payload: SheetQrPayload) {
  return [TOKEN_VERSION, payload.publicId, String(payload.pageNumber), payload.layoutVersion, payload.keyId].join('|')
}

/**
 * Formato: `key-id=segredo-base64url,key-anterior=segredo-base64url`.
 * A primeira chave assina emissões novas; as seguintes existem para validar
 * folhas impressas antes de uma rotação. Nenhuma chave sai deste módulo.
 */
export function readSheetQrSigningKeys(rawValue = process.env.SHEET_QR_SIGNING_KEYS): SheetQrSigningKey[] {
  if (!rawValue) throw new SheetQrSigningConfigurationError()

  const keys = rawValue.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const separator = entry.indexOf('=')
    if (separator <= 0) throw new SheetQrSigningConfigurationError()
    const keyId = entry.slice(0, separator)
    const encodedKey = entry.slice(separator + 1)
    if (!KEY_ID_PATTERN.test(keyId) || !encodedKey) throw new SheetQrSigningConfigurationError()

    const key = Buffer.from(encodedKey, 'base64url')
    if (key.length < 32) throw new SheetQrSigningConfigurationError()
    return { keyId, key }
  })

  if (keys.length === 0 || new Set(keys.map((key) => key.keyId)).size !== keys.length) {
    throw new SheetQrSigningConfigurationError()
  }
  return keys
}

export function createPageQrPayload(payload: Omit<SheetQrPayload, 'keyId'>, signingKey: SheetQrSigningKey): string {
  if (!PUBLIC_ID_PATTERN.test(payload.publicId) || !LAYOUT_PATTERN.test(payload.layoutVersion) || !Number.isInteger(payload.pageNumber) || payload.pageNumber < 1 || payload.pageNumber > 99) {
    throw new Error('Dados inválidos para emissão do QR da folha.')
  }
  const signedPayload = { ...payload, keyId: signingKey.keyId }
  const signature = createHmac('sha256', signingKey.key).update(signingInput(signedPayload)).digest('base64url')
  return [TOKEN_VERSION, signedPayload.publicId, signedPayload.pageNumber, signedPayload.layoutVersion, signingKey.keyId, signature].join('.')
}

export function createSheetTokenDigest(tokens: string[]): string {
  if (tokens.length === 0) throw new Error('Uma emissão precisa de ao menos uma página.')
  return createHash('sha256').update(tokens.join('\n')).digest('hex')
}

/**
 * Recupera os mesmos QR codes de um cartão já emitido. Como a assinatura é
 * determinística, o digest persistido também identifica a chave que assinou o
 * lote, inclusive depois de uma rotação de chave.
 */
export function issuedSheetTokens(params: {
  publicId: string
  pageCount: number
  layoutVersion: string
  tokenDigest: string | null
  signingKeys: SheetQrSigningKey[]
}): string[] | null {
  if (!params.tokenDigest || params.pageCount < 1) return null

  for (const signingKey of params.signingKeys) {
    const tokens = Array.from({ length: params.pageCount }, (_, pageIndex) => createPageQrPayload({
      publicId: params.publicId,
      pageNumber: pageIndex + 1,
      layoutVersion: params.layoutVersion,
    }, signingKey))
    if (createSheetTokenDigest(tokens) === params.tokenDigest) return tokens
  }

  return null
}

export function verifyPageQrPayload(value: string, signingKeys: SheetQrSigningKey[]): SheetQrPayload | null {
  const [version, publicId, rawPageNumber, layoutVersion, keyId, signature, ...extra] = value.split('.')
  const pageNumber = Number(rawPageNumber)
  if (extra.length > 0 || version !== TOKEN_VERSION || !PUBLIC_ID_PATTERN.test(publicId) || !LAYOUT_PATTERN.test(layoutVersion) || !KEY_ID_PATTERN.test(keyId) || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 99 || !signature) {
    return null
  }

  const signingKey = signingKeys.find((key) => key.keyId === keyId)
  if (!signingKey) return null
  const expected = createPageQrPayload({ publicId, pageNumber, layoutVersion }, signingKey).split('.').at(-1)!
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null
  return { publicId, pageNumber, layoutVersion, keyId }
}
