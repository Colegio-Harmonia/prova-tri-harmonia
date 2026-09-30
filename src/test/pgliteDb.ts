// Banco Postgres real em memória (PGlite) para testes de integração.
//
// O histórico de migrations do projeto não reconstrói o schema do zero (há
// colunas e tabelas criadas fora da cadeia — ver CLAUDE.md). Por isso: aplica
// as migrations em ordem, ignorando as que dependem de objetos inexistentes,
// e depois completa as colunas que `schema.ts` declara e o banco não tem.

import fs from 'node:fs'
import path from 'node:path'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'

export async function createTestDb() {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle } = await import('drizzle-orm/pglite')
  const schema = await import('@/db/schema')
  const pg = new PGlite()
  const dir = path.join(process.cwd(), 'drizzle')
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
    await pg.exec(fs.readFileSync(path.join(dir, file), 'utf8').replace(/-->\s*statement-breakpoint/g, '')).catch(() => undefined)
  }
  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue
    const config = getTableConfig(value)
    const existing = await pg.query<{ column_name: string }>('select column_name from information_schema.columns where table_name = $1', [config.name])
    if (!existing.rows.length) continue
    const present = new Set(existing.rows.map((row) => row.column_name))
    for (const column of config.columns) {
      if (present.has(column.name)) continue
      // Sem NOT NULL/default: o teste insere os valores de que precisa.
      await pg.exec(`alter table "${config.name}" add column if not exists "${column.name}" ${column.getSQLType()}`).catch(() => undefined)
    }
  }
  return { pg, db: drizzle(pg, { schema }) }
}

export function pgliteInstalled() {
  try { require.resolve('@electric-sql/pglite'); return true } catch { return false }
}
