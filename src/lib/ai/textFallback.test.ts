import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as schema from '@/db/schema'

const holder = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('@/db/client', () => ({ get db() { return holder.db } }))
import { getTextFallbackModel, saveTextFallbackModel } from './textFallback'

const client = new PGlite()
beforeAll(async () => {
  await client.exec(`
    CREATE TABLE users (id integer PRIMARY KEY);
    INSERT INTO users VALUES (8);
    CREATE TABLE application_settings (key text PRIMARY KEY, value text NOT NULL, updated_by integer REFERENCES users(id), updated_at timestamp DEFAULT now());
    CREATE TABLE administrative_audit (id serial PRIMARY KEY, actor_id integer REFERENCES users(id), action text NOT NULL, target_user_id integer, previous_value jsonb, next_value jsonb, created_at timestamp DEFAULT now());
    CREATE TABLE ai_model_profiles (id integer PRIMARY KEY, purpose text, provider text, model text, enabled boolean, input_cost_microusd_per_million integer, output_cost_microusd_per_million integer, image_cost_microusd integer, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());
    INSERT INTO ai_model_profiles (id,purpose,provider,model,enabled) VALUES (6,'text_generation','openai','gpt-4.1-mini',false), (7,'image_generation','openai','image',false);
  `)
  holder.db = drizzle(client, { schema })
})
afterAll(async () => { await client.close() })

describe('reserva persistente e auditada', () => {
  it('não escolhe automaticamente um modelo apenas por estar cadastrado', async () => {
    expect(await getTextFallbackModel()).toBeNull()
  })
  it('salva, consulta e desliga a escolha sem ativar o perfil principal', async () => {
    await saveTextFallbackModel(6, 8)
    expect(await getTextFallbackModel()).toMatchObject({ id: 6, enabled: false })
    await saveTextFallbackModel(null, 8)
    expect(await getTextFallbackModel()).toBeNull()
    const audit = await client.query<{ previous_value: unknown; next_value: unknown }>('SELECT previous_value,next_value FROM administrative_audit ORDER BY id')
    expect(audit.rows).toEqual([
      { previous_value: { profileId: null }, next_value: { profileId: 6 } },
      { previous_value: { profileId: 6 }, next_value: { profileId: null } },
    ])
  })
  it('reverte a mudança se a auditoria falha', async () => {
    await saveTextFallbackModel(6, 8)
    await client.exec("ALTER TABLE administrative_audit ADD CONSTRAINT reject_new CHECK (action <> 'text_generation_fallback_updated') NOT VALID")
    try {
      await expect(saveTextFallbackModel(null, 8)).rejects.toThrow()
      expect(await getTextFallbackModel()).toMatchObject({ id: 6 })
    } finally { await client.exec('ALTER TABLE administrative_audit DROP CONSTRAINT reject_new') }
  })
  it('ignora uma configuração que aponte para modelo de outra finalidade', async () => {
    await saveTextFallbackModel(7, 8)
    expect(await getTextFallbackModel()).toBeNull()
  })
})
