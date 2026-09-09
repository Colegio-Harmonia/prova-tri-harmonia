#!/usr/bin/env tsx
import fs from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

type CheckStatus = 'pass' | 'warn' | 'fail'
type Check = { name: string; status: CheckStatus; details: string }

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

function add(checks: Check[], status: CheckStatus, name: string, details: string) {
  checks.push({ name, status, details })
}

function countByCode(rows: Array<{ code: string; count: number }>) {
  return new Map(rows.map((row) => [row.code, Number(row.count)]))
}

async function main() {
  loadDatabaseUrlFromLocalEnv()
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL nao configurado.')

  const validationTimeout = setTimeout(() => {
    console.error('Timeout: validacao integrada excedeu 60 segundos.')
    process.exit(1)
  }, 60_000)
  const postgresClient = postgres(process.env.DATABASE_URL, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 1,
  })
  const db = drizzle(postgresClient)
  const checks: Check[] = []

  try {
    const taxonomyRows = await db.execute<{ code: string; category_count: number }>(sql`
    SELECT t.code, COUNT(c.*)::int AS category_count
    FROM pedagogical_taxonomies t
    LEFT JOIN pedagogical_categories c ON c.taxonomy_id = t.id AND c.is_active = true
    WHERE t.code IN ('DOK', 'SOLO_EXPECTED', 'SOLO_OBSERVED')
    GROUP BY t.code
    ORDER BY t.code
  `)
  const taxonomyCounts = new Map(taxonomyRows.map((row) => [row.code, Number(row.category_count)]))
  add(
    checks,
    taxonomyCounts.get('DOK') === 4 && taxonomyCounts.get('SOLO_EXPECTED') === 4 && taxonomyCounts.get('SOLO_OBSERVED') === 5 ? 'pass' : 'fail',
    'Catalogo de taxonomias/categorias',
    `DOK=${taxonomyCounts.get('DOK') ?? 0}, SOLO_EXPECTED=${taxonomyCounts.get('SOLO_EXPECTED') ?? 0}, SOLO_OBSERVED=${taxonomyCounts.get('SOLO_OBSERVED') ?? 0}`,
  )

  const duplicateCurrentRows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT classifiable_type, classifiable_id, classifiable_sub_id, taxonomy_id
      FROM pedagogical_classifications
      WHERE is_current = true
      GROUP BY classifiable_type, classifiable_id, classifiable_sub_id, taxonomy_id
      HAVING COUNT(*) > 1
    ) duplicated
  `)
  const duplicateCurrent = Number(duplicateCurrentRows[0]?.count ?? 0)
  add(checks, duplicateCurrent === 0 ? 'pass' : 'fail', 'Uma classificacao corrente por item/taxonomia', `${duplicateCurrent} duplicidade(s)`)

  const invalidConfidenceRows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM pedagogical_classifications
    WHERE confidence IS NULL OR confidence < 0 OR confidence > 1
  `)
  const invalidConfidence = Number(invalidConfidenceRows[0]?.count ?? 0)
  add(checks, invalidConfidence === 0 ? 'pass' : 'fail', 'Confianca entre 0 e 1', `${invalidConfidence} classificacao(oes) invalida(s)`)

  const missingPrimaryRows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM pedagogical_classifications
    WHERE classification_code IS NULL OR btrim(classification_code) = ''
  `)
  const missingPrimary = Number(missingPrimaryRows[0]?.count ?? 0)
  add(checks, missingPrimary === 0 ? 'pass' : 'fail', 'Classificacao principal obrigatoria', `${missingPrimary} classificacao(oes) sem codigo principal`)

  const currentGeneratedRows = await db.execute<{ code: string; count: number }>(sql`
    SELECT t.code, COUNT(*)::int AS count
    FROM pedagogical_classifications pc
    JOIN pedagogical_taxonomies t ON t.id = pc.taxonomy_id
    WHERE pc.classifiable_type = 'generated_exam_question'
      AND pc.is_current = true
      AND t.code IN ('DOK', 'SOLO_EXPECTED')
    GROUP BY t.code
  `)
  const currentGenerated = countByCode(currentGeneratedRows)
  add(
    checks,
    (currentGenerated.get('DOK') ?? 0) > 0 && (currentGenerated.get('SOLO_EXPECTED') ?? 0) > 0 ? 'pass' : 'warn',
    'Classificacao de questoes geradas',
    `DOK=${currentGenerated.get('DOK') ?? 0}, SOLO_EXPECTED=${currentGenerated.get('SOLO_EXPECTED') ?? 0}`,
  )

  const multiTaxonomyRows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT pc.classifiable_id, pc.classifiable_sub_id, COUNT(DISTINCT t.code) AS taxonomy_count
      FROM pedagogical_classifications pc
      JOIN pedagogical_taxonomies t ON t.id = pc.taxonomy_id
      WHERE pc.classifiable_type = 'generated_exam_question'
        AND pc.is_current = true
        AND t.code IN ('DOK', 'SOLO_EXPECTED')
      GROUP BY pc.classifiable_id, pc.classifiable_sub_id
      HAVING COUNT(DISTINCT t.code) >= 2
    ) multi
  `)
  const multiTaxonomy = Number(multiTaxonomyRows[0]?.count ?? 0)
  add(checks, multiTaxonomy > 0 ? 'pass' : 'warn', 'Multiplas taxonomias no mesmo item', `${multiTaxonomy} item(ns) com DOK e SOLO_EXPECTED`)

  const auditRows = await db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM pedagogical_classification_audit`)
  const auditCount = Number(auditRows[0]?.count ?? 0)
  add(checks, auditCount > 0 ? 'pass' : 'warn', 'Auditoria registrada', `${auditCount} evento(s)`)

  const soloExpectedPreRows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM pedagogical_classifications pc
    JOIN pedagogical_taxonomies t ON t.id = pc.taxonomy_id
    WHERE t.code = 'SOLO_EXPECTED' AND pc.classification_code = 'PRE_ESTRUTURAL'
  `)
  const soloExpectedPre = Number(soloExpectedPreRows[0]?.count ?? 0)
  add(checks, soloExpectedPre === 0 ? 'pass' : 'fail', 'SOLO_EXPECTED sem PRE_ESTRUTURAL', `${soloExpectedPre} violacao(oes)`)

  const soloObservedObjectiveRows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM pedagogical_classifications pc
    JOIN pedagogical_taxonomies t ON t.id = pc.taxonomy_id
    JOIN exam_corrections ec ON ec.id = pc.classifiable_id
    JOIN LATERAL jsonb_array_elements(ec.answers) answer ON (answer->>'questionNumber')::int = pc.classifiable_sub_id
    WHERE t.code = 'SOLO_OBSERVED'
      AND pc.classifiable_type = 'exam_correction_answer'
      AND answer->>'type' = 'objetiva'
  `)
  const soloObservedObjective = Number(soloObservedObjectiveRows[0]?.count ?? 0)
  add(checks, soloObservedObjective === 0 ? 'pass' : 'fail', 'SOLO_OBSERVED nunca em objetiva', `${soloObservedObjective} violacao(oes)`)

  const answerClassificationRows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM pedagogical_classifications pc
    WHERE pc.classifiable_type = 'exam_correction_answer'
      AND pc.is_current = true
  `)
  const answerClassificationCount = Number(answerClassificationRows[0]?.count ?? 0)
  add(checks, answerClassificationCount > 0 ? 'pass' : 'warn', 'Classificacao de resposta corrigida', `${answerClassificationCount} classificacao(oes) corrente(s)`)

  const importedEnemRows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM imported_question_classifications
    WHERE source = 'enem' AND enem_cognitive_axis_id IS NOT NULL
  `)
  const importedEnem = Number(importedEnemRows[0]?.count ?? 0)
  add(checks, importedEnem > 0 ? 'pass' : 'warn', 'Importacao ENEM com eixo cognitivo', `${importedEnem} classificacao(oes)`)

  const invalidAiPayloadRows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM generated_exams ge
    JOIN LATERAL jsonb_array_elements(ge.generation_payload->'questions') question ON true
    WHERE question->>'source' IS DISTINCT FROM 'enem_bank'
      AND (
        question->'pedagogicalClassification' IS NULL
        OR question#>>'{pedagogicalClassification,dok,categoryCode}' IS NULL
        OR question#>>'{pedagogicalClassification,soloExpected,categoryCode}' IS NULL
      )
  `)
  const invalidAiPayload = Number(invalidAiPayloadRows[0]?.count ?? 0)
  add(
    checks,
    invalidAiPayload === 0 ? 'pass' : 'warn',
    'Geracao IA com DOK e SOLO_EXPECTED estruturados',
    `${invalidAiPayload} questao(oes) historica(s) sem metadado`,
  )

  const existingDataRows = await db.execute<{ exams: number; corrections: number }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM generated_exams) AS exams,
      (SELECT COUNT(*)::int FROM exam_corrections) AS corrections
  `)
  add(
    checks,
    Number(existingDataRows[0]?.exams ?? 0) > 0 ? 'pass' : 'warn',
    'Compatibilidade com dados existentes',
    `generated_exams=${existingDataRows[0]?.exams ?? 0}, exam_corrections=${existingDataRows[0]?.corrections ?? 0}`,
  )

  const approvedRows = await db.execute<{ status: string; count: number }>(sql`
    SELECT status, COUNT(*)::int AS count
    FROM pedagogical_classifications
    WHERE status IN ('aprovada', 'rejeitada', 'desatualizada')
    GROUP BY status
  `)
  const statusCounts = countByCode(approvedRows.map((row) => ({ code: row.status, count: row.count })))
  add(
    checks,
    statusCounts.size > 0 ? 'pass' : 'warn',
    'Fluxos de revisao/versionamento com amostra',
    `aprovada=${statusCounts.get('aprovada') ?? 0}, rejeitada=${statusCounts.get('rejeitada') ?? 0}, desatualizada=${statusCounts.get('desatualizada') ?? 0}`,
  )

  console.log('Motor Pedagogico - validacao integrada')
  console.log('='.repeat(48))
  for (const check of checks) {
    const marker = check.status === 'pass' ? 'PASS' : check.status === 'warn' ? 'WARN' : 'FAIL'
    console.log(`[${marker}] ${check.name}: ${check.details}`)
  }

  const failed = checks.filter((check) => check.status === 'fail')
  const warned = checks.filter((check) => check.status === 'warn')
  console.log('='.repeat(48))
  console.log(`Resumo: ${checks.length - failed.length - warned.length} pass, ${warned.length} warn, ${failed.length} fail`)

  process.exitCode = failed.length > 0 ? 1 : 0
  } finally {
    clearTimeout(validationTimeout)
    await postgresClient.end({ timeout: 1 })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
