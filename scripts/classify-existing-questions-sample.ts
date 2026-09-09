#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'
import {
  classifyExistingGeneratedQuestionSample,
  type ExistingGeneratedQuestionSampleParams,
} from '../src/lib/pedagogical/existingQuestionClassificationService'

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

function optionalEnum<T extends string>(value: string | undefined, allowed: readonly T[], label: string): T | undefined {
  if (!value) return undefined
  if ((allowed as readonly string[]).includes(value)) return value as T
  throw new Error(`${label} invalido: ${value}`)
}

async function main() {
  loadDatabaseUrlFromLocalEnv()

  const params: ExistingGeneratedQuestionSampleParams = {
    apply: process.env.APPLY === 'true',
    limit: optionalNumber(process.env.LIMIT) ?? 5,
    examId: optionalNumber(process.env.EXAM_ID),
    subject: process.env.SUBJECT || undefined,
    segment: optionalEnum(
      process.env.SEGMENT,
      ['anos-iniciais', 'anos-finais', 'ensino-medio'] as const,
      'SEGMENT',
    ),
    status: optionalEnum(
      process.env.STATUS,
      ['rascunho', 'atribuido', 'em_andamento', 'revisao_concluida', 'aprovado', 'impresso', 'aplicado', 'corrigido'] as const,
      'STATUS',
    ),
    includeEnemBank: process.env.INCLUDE_ENEM_BANK !== 'false',
  }

  console.log('═══════════════════════════════════════════')
  console.log('  Motor Pedagogico — questoes existentes')
  console.log('═══════════════════════════════════════════')
  console.log(`  Modo: ${params.apply ? 'APLICAR' : 'SIMULAR'}`)
  console.log(`  LIMIT: ${params.limit}`)
  console.log(`  EXAM_ID: ${params.examId ?? 'todos recentes'}`)
  console.log(`  SUBJECT: ${params.subject ?? 'todas'}`)
  console.log(`  SEGMENT: ${params.segment ?? 'todos'}`)
  console.log(`  STATUS: ${params.status ?? 'todos'}`)
  console.log(`  INCLUDE_ENEM_BANK: ${params.includeEnemBank ? 'sim' : 'nao'}`)
  console.log('═══════════════════════════════════════════\n')

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL nao configurado.')
  }

  const results = await classifyExistingGeneratedQuestionSample(params)

  let createdCount = 0
  let simulatedCount = 0
  let skippedCount = 0

  for (const result of results) {
    console.log(`Prova ${result.exam.id} | ${result.exam.subject} ${result.exam.gradeYear}º | status=${result.exam.status}`)
    console.log(`Q${result.question.number} source=${result.question.source} type=${result.question.type} bloom=${result.question.bloomLevel}`)
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
  console.log(params.apply ? 'Execucao com gravacao concluida.' : 'Dry run concluido; nada foi gravado.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
