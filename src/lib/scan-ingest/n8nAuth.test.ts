import { describe, expect, it } from 'vitest'
import { getN8nScanWebhookToken, signN8nScanRequest, verifyN8nScanRequest } from './n8nAuth'

const secret = Buffer.alloc(32, 23).toString('base64url')

describe('autorização HMAC do worker n8n', () => {
  it('assina e valida conteúdo interno para uma tentativa específica', () => {
    const timestamp = '1785168000'
    const pathAndQuery = '/api/internal/scan-uploads/42/content?attemptId=17'
    const { signature } = signN8nScanRequest({ method: 'GET', pathAndQuery, timestamp }, secret)

    expect(verifyN8nScanRequest({
      method: 'GET',
      pathAndQuery,
      timestamp,
      signature,
      nowSeconds: 1785168010,
    }, secret)).toBe(true)
  })

  it('rejeita alteração de query, corpo e assinatura vencida', () => {
    const timestamp = '1785168000'
    const signed = signN8nScanRequest({ method: 'POST', pathAndQuery: '/webhook/scan', body: '{"attemptId":17}', timestamp }, secret)

    expect(verifyN8nScanRequest({
      method: 'POST', pathAndQuery: '/webhook/scan', body: '{"attemptId":18}', timestamp, signature: signed.signature, nowSeconds: 1785168010,
    }, secret)).toBe(false)
    expect(verifyN8nScanRequest({
      method: 'POST', pathAndQuery: '/webhook/scan', body: '{"attemptId":17}', timestamp, signature: signed.signature, nowSeconds: 1785169000,
    }, secret)).toBe(false)
  })

  it('assina os bytes exatos de uma página normalizada', () => {
    const timestamp = '1785168000'
    const pathAndQuery = '/api/internal/scan-pages/12/canonical?attemptId=17'
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
    const { signature } = signN8nScanRequest({ method: 'PUT', pathAndQuery, body: image, timestamp }, secret)

    expect(verifyN8nScanRequest({ method: 'PUT', pathAndQuery, body: image, timestamp, signature, nowSeconds: 1785168010 }, secret)).toBe(true)
    expect(verifyN8nScanRequest({ method: 'PUT', pathAndQuery, body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xfe]), timestamp, signature, nowSeconds: 1785168010 }, secret)).toBe(false)
  })
})

describe('token nativo do webhook n8n', () => {
  it('aceita um token configurado com tamanho suficiente', () => {
    expect(getN8nScanWebhookToken('a'.repeat(32))).toBe('a'.repeat(32))
  })

  it('rejeita token ausente ou curto', () => {
    expect(() => getN8nScanWebhookToken()).toThrow('N8N_SCAN_WEBHOOK_TOKEN')
    expect(() => getN8nScanWebhookToken('short')).toThrow('N8N_SCAN_WEBHOOK_TOKEN')
  })
})
