import { or, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import { blindIndex } from './fieldCrypto'

/**
 * Condição "esta linha é deste aluno/valor" para colunas cifradas.
 *
 * Casa pelo índice cego (linhas já convertidas) OU pelo texto puro legado
 * (linhas gravadas antes da conversão, ou por uma versão anterior do
 * sistema). A comparação de texto puro usa SQL direto de propósito: passar o
 * valor pelo Drizzle o cifraria, e a comparação nunca casaria.
 */
export function matchesEncrypted(column: AnyColumn, hashColumn: AnyColumn, value: string): SQL {
  return or(sql`${hashColumn} = ${blindIndex(value)}`, sql`${column} = ${value}`) as SQL
}

/** Índice cego de um valor opcional. */
export function hashOrNull(value: string | null | undefined): string | null {
  return value ? blindIndex(value) : null
}

/** Ordenação por nome feita na aplicação (o banco não ordena coluna cifrada). */
export function byStudentName<T>(nameOf: (row: T) => string | null | undefined): (a: T, b: T) => number {
  return (a, b) => (nameOf(a) ?? '').localeCompare(nameOf(b) ?? '', 'pt-BR', { sensitivity: 'base' })
}
