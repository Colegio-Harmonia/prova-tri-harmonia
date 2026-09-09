import https from 'node:https'
import type { IncomingHttpHeaders } from 'node:http'

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
])

const RETRY_DELAYS_MS = [250, 750] as const
const GOOGLE_OAUTH_HOSTS = new Set([
  'accounts.google.com',
  'oauth2.googleapis.com',
  'openidconnect.googleapis.com',
  // Após trocar o code por token, o provider Google busca este userinfo.
  'www.googleapis.com',
])

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type Sleep = (milliseconds: number) => Promise<void>

function isRetryableNetworkFailure(error: unknown) {
  if (!(error instanceof TypeError)) return false

  const cause = error.cause as { code?: unknown } | undefined
  return typeof cause?.code === 'string' && RETRYABLE_NETWORK_CODES.has(cause.code)
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function responseHeaders(headers: IncomingHttpHeaders) {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') result.set(name, value)
    else if (Array.isArray(value)) value.forEach((part) => result.append(name, part))
  }
  return result
}

function asFetchFailure(error: unknown) {
  return new TypeError('fetch failed', { cause: error })
}

// O host possui IPv6 publicado, mas não tem rota IPv6 funcional para o
// Google. O fetch nativo do Node alterna entre as famílias e ocasionalmente
// esgota o timeout; para os endpoints OAuth do Google, usar IPv4 elimina essa
// rota inválida. As demais URLs continuam no fetch nativo.
async function fetchGoogleOAuthOverIpv4(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const url = new URL(request.url)

  if (!GOOGLE_OAUTH_HOSTS.has(url.hostname)) return fetch(request)

  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : Buffer.from(await request.arrayBuffer())

  return new Promise<Response>((resolve, reject) => {
    const outgoing = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      family: 4,
      timeout: 10_000,
    }, (incoming) => {
      const chunks: Buffer[] = []
      incoming.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
      incoming.on('error', (error) => reject(asFetchFailure(error)))
      incoming.on('end', () => {
        resolve(new Response(Buffer.concat(chunks), {
          status: incoming.statusCode ?? 502,
          statusText: incoming.statusMessage ?? '',
          headers: responseHeaders(incoming.headers),
        }))
      })
    })

    outgoing.on('timeout', () => outgoing.destroy(Object.assign(new Error('Google OAuth connection timed out'), { code: 'ETIMEDOUT' })))
    outgoing.on('error', (error) => reject(asFetchFailure(error)))
    outgoing.end(body)
  })
}

// OAuth exige uma chamada ao token endpoint depois do consentimento. O host
// de produção tem apresentado timeouts de conexão transitórios com o Google;
// duas tentativas curtas evitam descartar um login por uma falha isolada.
// Só repetimos erros de rede conhecidos — respostas OAuth (inclusive 4xx) são
// devolvidas sem alteração, para não mascarar erro de credencial ou de escopo.
export function createGoogleOAuthFetchWithRetry(fetchImplementation: FetchImplementation = fetch, sleep: Sleep = wait): FetchImplementation {
  return async (input, init) => {
    let lastError: unknown

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        // O body de Request pode ser consumido pelo fetch. Clonar preserva o
        // mesmo payload para uma retentativa que falhou antes de conectar.
        const request = input instanceof Request ? input.clone() : input
        return await fetchImplementation(request, init)
      } catch (error) {
        lastError = error
        if (!isRetryableNetworkFailure(error) || attempt === RETRY_DELAYS_MS.length) throw error
        await sleep(RETRY_DELAYS_MS[attempt])
      }
    }

    throw lastError
  }
}

export const googleOAuthFetchWithRetry = createGoogleOAuthFetchWithRetry(fetchGoogleOAuthOverIpv4)
