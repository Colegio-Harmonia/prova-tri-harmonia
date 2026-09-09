import assert from 'node:assert/strict'
import { loginCredentialsSchema } from '../src/features/auth/schemas/login-credentials'

const validCredentials = {
  email: 'eduardo@colegioharmonia.com.br',
  password: 'senha de teste',
}

assert.deepEqual(loginCredentialsSchema.parse(validCredentials), validCredentials)

const emptyResult = loginCredentialsSchema.safeParse({ email: '', password: '' })
assert.equal(emptyResult.success, false)

if (!emptyResult.success) {
  assert.deepEqual(
    emptyResult.error.issues.map(({ path, message }) => ({ path: path[0], message })),
    [
      { path: 'email', message: 'Informe seu email.' },
      { path: 'password', message: 'Informe sua senha.' },
    ],
  )
}

const invalidEmailResult = loginCredentialsSchema.safeParse({
  email: 'email-invalido',
  password: 'senha',
})

assert.equal(invalidEmailResult.success, false)

if (!invalidEmailResult.success) {
  assert.equal(invalidEmailResult.error.issues[0]?.message, 'Informe um email válido.')
}

const credentialsWithWhitespace = {
  email: ' eduardo@colegioharmonia.com.br ',
  password: ' senha com espaços ',
}

const whitespaceResult = loginCredentialsSchema.safeParse(credentialsWithWhitespace)
assert.equal(whitespaceResult.success, false)
assert.equal(credentialsWithWhitespace.password, ' senha com espaços ')

console.log('Login credentials schema: OK')
