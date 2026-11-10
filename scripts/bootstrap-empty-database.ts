import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

// O histórico incremental não reconstrói o banco anterior a esta baseline.
// Este comando cria apenas a estrutura e recusa qualquer banco já utilizado.
async function main() {
  const expectedDatabase = process.argv[process.argv.indexOf('--database') + 1]
  if (!process.argv.includes('--database') || !expectedDatabase || expectedDatabase.startsWith('--')) {
    throw new Error('Informe explicitamente o banco vazio: npm run db:bootstrap -- --database NOME')
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurado')
  const sql = postgres(process.env.DATABASE_URL, { max: 1 })
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('prova-tri-bootstrap'))`
      const [database] = await tx`SELECT current_database() AS name`
      if (database.name !== expectedDatabase) throw new Error('O nome confirmado não corresponde ao banco conectado. Nenhuma alteração aplicada.')
      const [objects] = await tx`
        SELECT count(*)::int AS total FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND n.nspname NOT LIKE 'pg_temp%'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      `
      if (objects.total !== 0) throw new Error('Banco não está vazio. Bootstrap recusado; use uma migração revisada ou restaure o backup em outro banco.')
      const schema = readFileSync(fileURLToPath(new URL('../drizzle/bootstrap/20261110-schema.sql', import.meta.url)), 'utf8')
      await tx.unsafe(schema)
    })
    console.log('Estrutura criada no banco vazio confirmado. Dados e catálogos não foram importados.')
  } finally {
    await sql.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Falha ao preparar banco vazio')
  process.exitCode = 1
})
