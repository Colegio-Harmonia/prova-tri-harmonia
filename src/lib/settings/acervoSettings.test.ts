import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@/db/schema'

const holder = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('@/db/client', () => ({ get db() { return holder.db } }))
import { getAcervoApiUrl, saveAcervoApiUrl } from './acervoSettings'

const client = new PGlite()
beforeAll(async () => {
  await client.exec(`
    CREATE TABLE users (id integer PRIMARY KEY);
    INSERT INTO users VALUES (8);
    CREATE TABLE administrative_audit (
      id serial PRIMARY KEY, actor_id integer REFERENCES users(id), action text NOT NULL,
      target_user_id integer, previous_value jsonb, next_value jsonb,
      created_at timestamp DEFAULT now() NOT NULL
    );
  `)
  await client.exec(readFileSync('drizzle/0053_application_settings.sql', 'utf8'))
  holder.db = drizzle(client, { schema })
})
afterEach(async () => {
  await client.exec('DELETE FROM application_settings; DELETE FROM administrative_audit;')
  vi.unstubAllEnvs()
})
afterAll(async () => { await client.close() })

describe('persistência da configuração do acervo', () => {
  it('mantém o endereço existente enquanto não houver configuração salva', async () => {
    vi.stubEnv('ACERVO_API_URL', 'http://acervo-env.local:5000')
    expect(await getAcervoApiUrl()).toBe('http://acervo-env.local:5000')
    vi.stubEnv('ACERVO_API_URL', '')
    expect(await getAcervoApiUrl()).toBe('http://100.105.29.106:5000')
  })

  it('prioriza o endereço salvo e consulta mudanças sem cache de processo', async () => {
    vi.stubEnv('ACERVO_API_URL', 'http://acervo-env.local:5000')
    await saveAcervoApiUrl('192.168.1.77:5050', 8)
    expect(await getAcervoApiUrl()).toBe('http://192.168.1.77:5050')
    await saveAcervoApiUrl('https://acervo.escola.com.br/', 8)
    expect(await getAcervoApiUrl()).toBe('https://acervo.escola.com.br')
    const audit = await client.query<{ previous_value: { url: string }; next_value: { url: string } }>(
      'SELECT previous_value, next_value FROM administrative_audit ORDER BY id',
    )
    expect(audit.rows).toEqual([
      { previous_value: { url: 'http://acervo-env.local:5000' }, next_value: { url: 'http://192.168.1.77:5050' } },
      { previous_value: { url: 'http://192.168.1.77:5050' }, next_value: { url: 'https://acervo.escola.com.br' } },
    ])
  })

  it('reverte a configuração se não conseguir registrar a auditoria', async () => {
    await saveAcervoApiUrl('192.168.1.77:5050', 8)
    await client.exec("ALTER TABLE administrative_audit ADD CONSTRAINT reject_new_audit CHECK (action <> 'acervo_api_url_updated') NOT VALID")
    try {
      await expect(saveAcervoApiUrl('192.168.1.88:5050', 8)).rejects.toThrow()
      expect(await getAcervoApiUrl()).toBe('http://192.168.1.77:5050')
    } finally {
      await client.exec('ALTER TABLE administrative_audit DROP CONSTRAINT reject_new_audit')
    }
  })
})
