import assert from 'node:assert/strict'
import { ApiError, apiRequest } from '../src/lib/api/client'

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  })
}

async function run() {
  let receivedHeaders: HeadersInit | undefined
  const success = await apiRequest<{ users: Array<{ id: number }> }>('/api/users', {
    fetchFn: async (_input, init) => {
      receivedHeaders = init?.headers
      return jsonResponse({ users: [{ id: 1 }] })
    },
  })

  assert.deepEqual(success, { users: [{ id: 1 }] })
  assert.equal(new Headers(receivedHeaders).get('accept'), 'application/json')

  const empty = await apiRequest<void>('/api/empty', {
    fetchFn: async () => new Response(null, { status: 204 }),
  })
  assert.equal(empty, undefined)

  await assert.rejects(
    () =>
      apiRequest('/api/forbidden', {
        fetchFn: async () => jsonResponse({ error: 'Acesso negado.', code: 'FORBIDDEN' }, { status: 403 }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, 403)
      assert.equal(error.code, 'FORBIDDEN')
      assert.equal(error.message, 'Acesso negado.')
      return true
    },
  )

  await assert.rejects(
    () =>
      apiRequest('/api/unavailable', {
        fetchFn: async () => {
          throw new Error('network unavailable')
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, undefined)
      assert.equal(error.message, 'Não foi possível conectar ao serviço. Tente novamente.')
      return true
    },
  )

  await assert.rejects(
    () =>
      apiRequest('/api/invalid-json', {
        fetchFn: async () => new Response('<html>erro</html>', { status: 200 }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.message, 'A API retornou uma resposta que não é JSON.')
      return true
    },
  )
}

run()
  .then(() => {
    console.log('API client contract checks passed.')
  })
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
