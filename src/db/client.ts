import postgres from 'postgres'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from './schema'

// `ReturnType<typeof drizzle>` doesn't carry the schema type parameter
// through (drizzle() is generic/overloaded) — PostgresJsDatabase<typeof
// schema> is the type that actually gives `db.query.users` etc. real types.
type Db = PostgresJsDatabase<typeof schema>

let _db: Db | null = null

function getOrInitDb(): Db {
  if (_db) return _db

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL não configurado')

  // A static import (not require(...).default — that broke both in the
  // Next.js server bundle and under tsx, since `postgres`'s CJS entrypoint
  // isn't wrapped in `{ default }`) is safe to bundle here: build-time
  // bundling of `postgres` is already prevented via
  // experimental.serverComponentsExternalPackages in next.config.mjs, so
  // there's no need for a manual dynamic-require workaround.
  //
  // No "initializing" guard on purpose — client construction is cheap and
  // doesn't itself open a connection (that happens lazily on first query),
  // so if two calls race before `_db` is set, both just build a client and
  // the last write wins; harmless. A guard left `true` forever on error (no
  // try/finally) is worse: it deadlocks every future call app-wide, which
  // is what happened before this fix.
  _db = drizzle(postgres(connectionString), { schema })
  return _db
}

/**
 * Conexão lazy com o banco — só conecta quando a primeira query for executada.
 * Isso evita que o build do Next.js trave quando o PostgreSQL não está rodando.
 */
export function getDb(): Db {
  return getOrInitDb()
}

// Proxy que adia a criação da conexão até o primeiro acesso a qualquer método.
// Isto permite que os imports existentes (import { db }) continuem funcionando.
export const db = new Proxy({} as Db, {
  get(_, prop) {
    const instance = getOrInitDb()
    const value = (instance as any)[prop as string]
    return typeof value === 'function' ? value.bind(instance) : value
  },
})
