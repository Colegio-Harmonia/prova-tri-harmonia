export type ApiErrorPayload = {
  code?: string
  error?: string
  message?: string
}

export type ApiRequestOptions = RequestInit & {
  fetchFn?: typeof fetch
}

export class ApiError extends Error {
  readonly status?: number
  readonly code?: string
  readonly payload?: unknown

  constructor(
    message: string,
    options: {
      status?: number
      code?: string
      payload?: unknown
    } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status
    this.code = options.code
    this.payload = options.payload
  }
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return typeof value === 'object' && value !== null
}

function getErrorMessage(payload: unknown, status: number, statusText: string) {
  if (isApiErrorPayload(payload)) {
    if (typeof payload.error === 'string' && payload.error.length > 0) return payload.error
    if (typeof payload.message === 'string' && payload.message.length > 0) return payload.message
  }

  return statusText || `A solicitação falhou (HTTP ${status}).`
}

async function readJsonPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Requests JSON from an existing route handler and exposes a consistent error
 * shape to client components. Route contracts remain owned by src/app/api.
 */
export async function apiRequest<T>(input: RequestInfo | URL, options: ApiRequestOptions = {}): Promise<T> {
  const { fetchFn, headers, ...requestOptions } = options
  const requestHeaders = new Headers(headers)

  if (!requestHeaders.has('accept')) {
    requestHeaders.set('accept', 'application/json')
  }

  let response: Response
  try {
    response = await (fetchFn ?? globalThis.fetch)(input, {
      ...requestOptions,
      headers: requestHeaders,
    })
  } catch {
    throw new ApiError('Não foi possível conectar ao serviço. Tente novamente.')
  }

  const payload = await readJsonPayload(response)

  if (!response.ok) {
    const code = isApiErrorPayload(payload) && typeof payload.code === 'string' ? payload.code : undefined

    throw new ApiError(getErrorMessage(payload, response.status, response.statusText), {
      status: response.status,
      code,
      payload,
    })
  }

  if (payload === undefined) {
    return undefined as T
  }

  if (typeof payload === 'string') {
    throw new ApiError('A API retornou uma resposta que não é JSON.', {
      status: response.status,
      payload,
    })
  }

  return payload as T
}
