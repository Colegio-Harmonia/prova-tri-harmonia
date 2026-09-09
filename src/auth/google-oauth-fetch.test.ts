import { describe, expect, it, vi } from 'vitest'

import { createGoogleOAuthFetchWithRetry } from './google-oauth-fetch'

function timeoutError() {
  return new TypeError('fetch failed', { cause: { code: 'ETIMEDOUT' } })
}

describe('fetch resiliente do OAuth Google', () => {
  it('repete timeout transitório e devolve a resposta da tentativa seguinte', async () => {
    const response = new Response('{}', { status: 200 })
    const fetchImplementation = vi.fn().mockRejectedValueOnce(timeoutError()).mockResolvedValueOnce(response)
    const sleep = vi.fn(async () => {})
    const fetchWithRetry = createGoogleOAuthFetchWithRetry(fetchImplementation, sleep)

    await expect(fetchWithRetry('https://oauth2.googleapis.com/token')).resolves.toBe(response)

    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(250)
  })

  it('não repete erro OAuth retornado como resposta HTTP', async () => {
    const response = new Response('{"error":"invalid_grant"}', { status: 400 })
    const fetchImplementation = vi.fn().mockResolvedValue(response)
    const sleep = vi.fn(async () => {})
    const fetchWithRetry = createGoogleOAuthFetchWithRetry(fetchImplementation, sleep)

    await expect(fetchWithRetry('https://oauth2.googleapis.com/token')).resolves.toBe(response)

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('propaga erro não transitório sem tentar novamente', async () => {
    const fetchImplementation = vi.fn().mockRejectedValue(new TypeError('request invalid'))
    const sleep = vi.fn(async () => {})
    const fetchWithRetry = createGoogleOAuthFetchWithRetry(fetchImplementation, sleep)

    await expect(fetchWithRetry('https://oauth2.googleapis.com/token')).rejects.toThrow('request invalid')

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })
})
