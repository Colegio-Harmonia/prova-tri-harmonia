#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'
import { classifyImportedEnemSample } from '../src/lib/pedagogical/importedEnemClassificationService'

function loadDatabaseUrlFromLocalEnv() {
  if (process.env.DATABASE_URL) return

  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return

  const databaseUrlLine = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith('DATABASE_URL='))

  if (!databaseUrlLine) return

  const value = databaseUrlLine.slice(databaseUrlLine.indexOf('=') + 1).trim()
  process.env.DATABASE_URL = value.replace(/^['"]|['"]$/g, '')
}

function optionalNumber(value: string | undefined) {
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Valor numerico invalido: ${value}`)
  }
  return parsed
}

async function main() {
  loadDatabaseUrlFromLocalEnv()

  const apply = process.env.APPLY === 'true'
  const limit = optionalNumber(process.env.LIMIT) ?? 5
  const year = optionalNumber(process.env.YEAR)
  const discipline = process.env.DISCIPLINE || undefined
  const includeExisting = process.env.INCLUDE_EXISTING === 'true'

  console.log('═══════════════════════════════════════════')
  console.log('  Motor Pedagogico — amostra ENEM')
  console.log('═══════════════════════════════════════════')
  console.log(`  Modo: ${apply ? 'APLICAR' : 'SIMULAR'}`)
  console.log(`  LIMIT: ${limit}`)
  console.log(`  YEAR: ${year ?? 'todos'}`)
  console.log(`  DISCIPLINE: ${discipline ?? 'todas'}`)
  console.log(`  INCLUDE_EXISTING: ${includeExisting ? 'sim' : 'nao'}`)
  console.log('═══════════════════════════════════════════\n')

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL nao configurado.')
  }

  const results = await classifyImportedEnemSample({
    apply,
    limit,
    year,
    discipline,
    includeExisting,
  })

  let createdCount = 0
  let simulatedCount = 0
  let skippedCount = 0

  for (const result of results) {
    console.log(`Q${result.question.questionIndex}/${result.question.year} id=${result.question.id} disc=${result.question.discipline ?? '?'}`)
    console.log(`  ${result.preview}`)

    for (const proposal of result.proposals) {
      const status = proposal.created
        ? `criada #${proposal.created.id}`
        : proposal.skippedReason
          ? 'ignorada'
          : 'simulada'

      if (proposal.created) createdCount++
      else if (proposal.skippedReason) skippedCount++
      else simulatedCount++

      console.log(
        `  - ${proposal.taxonomyCode}: ${proposal.categoryCode} conf=${proposal.confidence.toFixed(2)} band=${proposal.confidenceBand} status=${status}`,
      )
      if (proposal.skippedReason) console.log(`    motivo: ${proposal.skippedReason}`)
    }

    console.log('')
  }

  console.log('Resumo:')
  console.log(`  Questoes analisadas: ${results.length}`)
  console.log(`  Propostas simuladas: ${simulatedCount}`)
  console.log(`  Classificacoes criadas: ${createdCount}`)
  console.log(`  Propostas ignoradas: ${skippedCount}`)
  console.log(apply ? 'Execucao com gravacao concluida.' : 'Dry run concluido; nada foi gravado.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
