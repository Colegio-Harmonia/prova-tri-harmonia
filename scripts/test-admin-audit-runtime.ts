import assert from 'node:assert/strict'

const baseUrl = process.env.TEST_BASE_URL
const adminEmail = process.env.TEST_ADMIN_EMAIL
const adminPassword = process.env.TEST_ADMIN_PASSWORD
const professorEmail = process.env.TEST_PROFESSOR_EMAIL
const professorPassword = process.env.TEST_PROFESSOR_PASSWORD

if (!baseUrl || !adminEmail || !adminPassword) {
  throw new Error('Defina TEST_BASE_URL, TEST_ADMIN_EMAIL e TEST_ADMIN_PASSWORD.')
}

type CookieClient = {
  request: (path: string, init?: RequestInit) => Promise<Response>
  login: (email: string, password: string) => Promise<void>
}

function createCookieClient(): CookieClient {
  const cookies = new Map<string, string>()

  function captureCookies(response: Response) {
    const values = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean) as string[]

    for (const value of values) {
      const [pair] = value.split(';')
      const separator = pair.indexOf('=')
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
  }

  async function request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers)
    if (cookies.size) headers.set('cookie', [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; '))
    const response = await fetch(new URL(path, baseUrl), { ...init, headers, redirect: 'manual' })
    captureCookies(response)
    return response
  }

  return {
    request,
    async login(email, password) {
      const csrfResponse = await request('/api/auth/csrf')
      assert.equal(csrfResponse.status, 200, 'CSRF do Auth.js deve responder 200')
      const { csrfToken } = await csrfResponse.json() as { csrfToken: string }
      const body = new URLSearchParams({ csrfToken, email, password, callbackUrl: new URL('/usuarios', baseUrl).toString() })
      const response = await request('/api/auth/callback/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      })
      assert.ok([200, 302].includes(response.status), `Login deve concluir, recebido ${response.status}`)
      assert.ok([...cookies.keys()].some((name) => name.includes('session-token')), 'Login deve criar sessão')
    },
  }
}

async function main() {
  const anonymous = await fetch(new URL('/api/admin/audit', baseUrl), { redirect: 'manual' })
  assert.equal(anonymous.status, 401, 'Auditoria não pode ser acessada sem sessão')

  const admin = createCookieClient()
  await admin.login(adminEmail, adminPassword)

  const email = `auditoria.fase7.${Date.now()}@colegioharmonia.com.br`
  const create = await admin.request('/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Alvo de auditoria DEV', email, role: 'professor' }),
  })
  assert.equal(create.status, 200, 'Admin deve criar conta de teste')
  const { user } = await create.json() as { user: { id: number } }

  for (const active of [false, true]) {
    const update = await admin.request(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active }),
    })
    assert.equal(update.status, 200, `Admin deve ${active ? 'reativar' : 'desativar'} conta de teste`)
  }

  const audit = await admin.request('/api/admin/audit')
  assert.equal(audit.status, 200, 'Admin deve consultar auditoria')
  const { events } = await audit.json() as { events: Array<{ action: string, targetUserId: number, actorName: string | null, targetUserName: string | null }> }
  const targetEvents = events.filter((event) => event.targetUserId === user.id)
  const actions = targetEvents.map((event) => event.action)
  assert.deepEqual(actions.sort(), ['user_activated', 'user_created', 'user_deactivated'])
  assert.ok(targetEvents.every((event) => event.actorName), 'Eventos devem identificar quem executou a ação')
  assert.ok(targetEvents.every((event) => event.targetUserName === 'Alvo de auditoria DEV'), 'Eventos devem identificar a conta afetada')

  if (professorEmail && professorPassword) {
    const professor = createCookieClient()
    await professor.login(professorEmail, professorPassword)
    const [auditResponse, usersResponse] = await Promise.all([
      professor.request('/api/admin/audit'),
      professor.request('/api/users?all=1'),
    ])
    assert.equal(auditResponse.status, 403, 'Professor não pode consultar auditoria')
    assert.equal(usersResponse.status, 403, 'Professor não pode listar todas as contas')
  }

  console.log('Admin audit runtime: OK')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
