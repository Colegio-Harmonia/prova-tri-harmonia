import { createHash, createHmac, timingSafeEqual } from 'crypto'

const MAX_SIGNATURE_AGE_SECONDS = 5 * 60

export class N8nScanConfigurationError extends Error {
  constructor(message = 'A configuração segura do n8n para scans está ausente ou inválida.') {
    super(message)
  }
}

function readSecret(rawValue = process.env.N8N_SCAN_SHARED_SECRET) {
  if (!rawValue) throw new N8nScanConfigurationError()
  const secret = Buffer.from(rawValue, 'base64url')
  if (secret.length < 32) throw new N8nScanConfigurationError()
  return secret
}

function readWebhookToken(rawValue = process.env.N8N_SCAN_WEBHOOK_TOKEN) {
  if (!rawValue || rawValue.length < 32) throw new N8nScanConfigurationError('N8N_SCAN_WEBHOOK_TOKEN não configurado ou inválido.')
  return rawValue
}

function canonicalRequest(method: string, pathAndQuery: string, timestamp: string, body: string | Buffer) {
  const bodyHash = createHash('sha256').update(body).digest('hex')
  return [method.toUpperCase(), pathAndQuery, timestamp, bodyHash].join('\n')
}

export function signN8nScanRequest(params: { method: string; pathAndQuery: string; body?: string | Buffer; timestamp?: string }, rawSecret?: string) {
  const timestamp = params.timestamp ?? String(Math.floor(Date.now() / 1000))
  const secret = rawSecret === undefined ? readSecret() : Buffer.from(rawSecret, 'base64url')
  if (secret.length < 32) throw new N8nScanConfigurationError()
  const signature = createHmac('sha256', secret).update(canonicalRequest(params.method, params.pathAndQuery, timestamp, params.body ?? '')).digest('base64url')
  return { timestamp, signature }
}

export function verifyN8nScanRequest(params: { method: string; pathAndQuery: string; body?: string | Buffer; timestamp: string | null; signature: string | null; nowSeconds?: number }, rawSecret?: string) {
  if (!params.timestamp || !params.signature || !/^\d{10}$/.test(params.timestamp)) return false
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - Number(params.timestamp)) > MAX_SIGNATURE_AGE_SECONDS) return false
  let expected: string
  try {
    expected = signN8nScanRequest({ method: params.method, pathAndQuery: params.pathAndQuery, body: params.body, timestamp: params.timestamp }, rawSecret).signature
  } catch {
    return false
  }
  const actualBuffer = Buffer.from(params.signature)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

export function getN8nScanWebhookUrl(rawValue = process.env.N8N_SCAN_WEBHOOK_URL) {
  if (!rawValue) throw new N8nScanConfigurationError('N8N_SCAN_WEBHOOK_URL não configurado.')
  let url: URL
  try {
    url = new URL(rawValue)
  } catch {
    throw new N8nScanConfigurationError('N8N_SCAN_WEBHOOK_URL inválida.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new N8nScanConfigurationError('N8N_SCAN_WEBHOOK_URL precisa usar http ou https.')
  return url
}

/** Token enviado exclusivamente ao mecanismo nativo de autenticação do webhook no n8n. */
export function getN8nScanWebhookToken(rawValue = process.env.N8N_SCAN_WEBHOOK_TOKEN) {
  return readWebhookToken(rawValue)
}
