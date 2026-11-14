/**
 * Conversão dos dados de aluno já gravados: texto puro → cifra, e índice
 * cego → HMAC com a chave. Lê e grava com SQL direto, de propósito: pelo
 * Drizzle as colunas viriam já decifradas e não daria para saber o que ainda
 * está em texto puro.
 *
 * Idempotente: valor já cifrado não é cifrado de novo; pode ser rodada quantas
 * vezes for preciso (inclusive depois de a versão anterior do sistema ter
 * gravado linhas novas em texto puro). Com `apply: false` só conta.
 */
import { sql } from 'drizzle-orm'
import { blindIndex, decryptField, encryptField, fieldEncryptionEnabled, FieldCryptoError, isEncryptedValue } from './fieldCrypto'

type Executor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> }

type TableSpec = { table: string; columns: string[]; hashes: Record<string, string> }

/** Tabelas e colunas com dado pessoal de aluno. `hashes`: coluna de índice cego → coluna de origem. */
export const STUDENT_DATA_TABLES: TableSpec[] = [
  { table: 'activity_classroom_results', columns: ['classroom_student_id', 'student_name', 'student_email'], hashes: { classroom_student_hash: 'classroom_student_id' } },
  { table: 'exam_corrections', columns: ['classroom_student_id', 'student_name', 'student_email'], hashes: { classroom_student_hash: 'classroom_student_id', student_name_hash: 'student_name' } },
  { table: 'exam_sheet_assignments', columns: ['classroom_student_id', 'student_name_snapshot', 'student_email_snapshot'], hashes: { classroom_student_hash: 'classroom_student_id' } },
  { table: 'adapted_exams', columns: ['target_student_label'], hashes: {} },
]
/** Colunas jsonb cujo conteúdo inteiro é cifrado. */
export const STUDENT_DATA_JSON_COLUMNS = [{ table: 'enem_sae_imports', column: 'analysis' }]

export type BackfillTableReport = { table: string; rows: number; valuesEncrypted: number; valuesAlreadyEncrypted: number; hashesUpdated: number }
export type BackfillReport = { applied: boolean; tables: BackfillTableReport[]; plaintextRemaining: number }

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>
  return ((result as { rows?: Array<Record<string, unknown>> } | null)?.rows) ?? []
}

async function convertTable(db: Executor, spec: TableSpec, apply: boolean): Promise<BackfillTableReport> {
  const selected = [...spec.columns, ...Object.keys(spec.hashes)]
  const rows = rowsOf(await db.execute(sql`select id, ${sql.join(selected.map((column) => sql.identifier(column)), sql`, `)} from ${sql.identifier(spec.table)} order by id`))
  const report: BackfillTableReport = { table: spec.table, rows: rows.length, valuesEncrypted: 0, valuesAlreadyEncrypted: 0, hashesUpdated: 0 }

  for (const row of rows) {
    const sets: Array<ReturnType<typeof sql>> = []
    const plain: Record<string, string | null> = {}
    for (const column of spec.columns) {
      const stored = row[column]
      if (typeof stored !== 'string') { plain[column] = null; continue }
      plain[column] = decryptField(stored) // também valida que a chave atual lê o que já está cifrado
      if (isEncryptedValue(stored)) { report.valuesAlreadyEncrypted++; continue }
      report.valuesEncrypted++
      sets.push(sql`${sql.identifier(column)} = ${encryptField(stored)}`)
    }
    for (const [hashColumn, source] of Object.entries(spec.hashes)) {
      const value = plain[source]
      const expected = value === null || value === undefined ? null : blindIndex(value)
      if ((row[hashColumn] ?? null) === expected) continue
      report.hashesUpdated++
      sets.push(sql`${sql.identifier(hashColumn)} = ${expected}`)
    }
    if (apply && sets.length) await db.execute(sql`update ${sql.identifier(spec.table)} set ${sql.join(sets, sql`, `)} where id = ${row.id as number}`)
  }
  return report
}

async function convertJsonColumn(db: Executor, spec: { table: string; column: string }, apply: boolean): Promise<BackfillTableReport> {
  const rows = rowsOf(await db.execute(sql`select id, ${sql.identifier(spec.column)}::text as value from ${sql.identifier(spec.table)} order by id`))
  const report: BackfillTableReport = { table: `${spec.table}.${spec.column}`, rows: rows.length, valuesEncrypted: 0, valuesAlreadyEncrypted: 0, hashesUpdated: 0 }
  for (const row of rows) {
    const text = row.value
    if (typeof text !== 'string') continue
    const parsed = JSON.parse(text) as unknown
    const envelope = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 1 ? (parsed as Record<string, unknown>).__enc : undefined
    if (typeof envelope === 'string') { decryptField(envelope); report.valuesAlreadyEncrypted++; continue }
    report.valuesEncrypted++
    if (apply) await db.execute(sql`update ${sql.identifier(spec.table)} set ${sql.identifier(spec.column)} = ${JSON.stringify({ __enc: encryptField(JSON.stringify(parsed)) })}::jsonb where id = ${row.id as number}`)
  }
  return report
}

/** Quantos valores de aluno ainda estão em texto puro no banco. */
export async function countPlaintext(db: Executor): Promise<number> {
  let total = 0
  for (const spec of STUDENT_DATA_TABLES) {
    for (const column of spec.columns) {
      const [row] = rowsOf(await db.execute(sql`select count(*)::int as n from ${sql.identifier(spec.table)} where ${sql.identifier(column)} is not null and ${sql.identifier(column)} not like 'enc:v1:%'`))
      total += Number(row?.n ?? 0)
    }
  }
  for (const spec of STUDENT_DATA_JSON_COLUMNS) {
    const [row] = rowsOf(await db.execute(sql`select count(*)::int as n from ${sql.identifier(spec.table)} where not (${sql.identifier(spec.column)} ? '__enc')`))
    total += Number(row?.n ?? 0)
  }
  return total
}

export async function backfillStudentData(db: Executor, options: { apply: boolean }): Promise<BackfillReport> {
  if (!fieldEncryptionEnabled()) throw new FieldCryptoError('STUDENT_DATA_KEY não está configurada: não há com o que cifrar.')
  const tables: BackfillTableReport[] = []
  for (const spec of STUDENT_DATA_TABLES) tables.push(await convertTable(db, spec, options.apply))
  for (const spec of STUDENT_DATA_JSON_COLUMNS) tables.push(await convertJsonColumn(db, spec, options.apply))
  return { applied: options.apply, tables, plaintextRemaining: await countPlaintext(db) }
}
