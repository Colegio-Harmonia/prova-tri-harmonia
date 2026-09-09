import axios from 'axios'
import { getN8nScanWebhookToken, getN8nScanWebhookUrl, signN8nScanRequest } from './n8nAuth'

export type N8nScanDispatchPayload = {
  schemaVersion: 'PTR1_SCAN_DISPATCH_V1'
  attemptId: number
  uploadId: number
  examId: number
  sha256: string
  pageCount: number
  pages: Array<{
    id: number
    pageIndex: number
  }>
  // Apenas estrutura do layout, sem texto de questão, aluno ou gabarito. O
  // worker seleciona a página pelo número presente no QR, não pela ordem em
  // que os arquivos saíram do scanner.
  sheetLayout: Array<{
    pageNumber: number
    expectedPageType: 'objective' | 'discursive'
    questions: Array<{ number: number; alternatives?: number }>
  }>
  contentPath: string
}

/** Envia somente referência interna e metadados; nunca bytes, QR ou PII. */
export async function dispatchScanToN8n(payload: N8nScanDispatchPayload) {
  const webhookUrl = getN8nScanWebhookUrl()
  const webhookToken = getN8nScanWebhookToken()
  const body = JSON.stringify(payload)
  const pathAndQuery = `${webhookUrl.pathname}${webhookUrl.search}`
  const { timestamp, signature } = signN8nScanRequest({ method: 'POST', pathAndQuery, body })
  await axios.post(webhookUrl.toString(), body, {
    // O worker só responde depois de devolver a leitura e arquivar, de forma
    // privada, a página normalizada e os recortes de conferência. Para uma
    // página objetiva isso pode levar mais que o timeout HTTP curto padrão;
    // encerrar antes marcaria uma tentativa concluída como falha no Prova-TRI.
    timeout: 120_000,
    headers: {
      'Content-Type': 'application/json',
      'X-ProvaTri-Timestamp': timestamp,
      'X-ProvaTri-Signature': signature,
      'X-ProvaTri-Webhook-Token': webhookToken,
    },
    maxContentLength: 32 * 1024,
    maxBodyLength: 32 * 1024,
    validateStatus: (status) => status >= 200 && status < 300,
  })
}
