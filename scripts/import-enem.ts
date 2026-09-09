#!/usr/bin/env tsx
/**
 * Importador de Questões do ENEM
 *
 * Busca todas as questões da API pública enem.dev e importa
 * para o banco PostgreSQL do Prova-TRI.
 *
 * Uso:
 *   tsx scripts/import-enem.ts
 *
 * Variáveis de ambiente:
 *   DATABASE_URL  (obrigatória, sem valor default)
 *   ENEM_API_URL  (default: https://api.enem.dev/v1)
 *   DRY_RUN       (se definido, apenas exibe o que seria feito sem inserir)
 *   YEARS         (lista opcional separada por vírgulas, ex.: YEARS=2024,2025)
 *   RESUME        (legado: limita a anos até o valor informado, ex.: RESUME=2021)
 */

import postgres from 'postgres'
import axios from 'axios'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// ── Config ──────────────────────────────────────────────────────────
function loadDatabaseUrlFromLocalEnv() {
  if (process.env.DATABASE_URL) return
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith('DATABASE_URL='))
  if (!line) return
  process.env.DATABASE_URL = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}
loadDatabaseUrlFromLocalEnv()

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL não definida. Configure a variável de ambiente antes de rodar este script.')
}
const ENEM_API_URL = process.env.ENEM_API_URL || 'https://api.enem.dev/v1'
const DRY_RUN = process.env.DRY_RUN === 'true'
const RESUME_YEAR = process.env.RESUME ? parseInt(process.env.RESUME, 10) : null
const YEARS = process.env.YEARS
  ? process.env.YEARS.split(',').map((year) => parseInt(year.trim(), 10)).filter(Number.isFinite)
  : null

// ── Tipos ───────────────────────────────────────────────────────────
interface EnemAlternative {
  letter: string
  text: string | null
  file: string | null
  isCorrect: boolean
}

interface EnemQuestion {
  title: string
  index: number
  discipline: string | null
  language: string | null
  year: number
  context: string | null
  files: string[]
  correctAlternative: string
  alternativesIntroduction: string | null
  alternatives: EnemAlternative[]
}

// ── Rate Limiting ───────────────────────────────────────────────────
let lastRequestTime = 0
const MIN_REQUEST_INTERVAL = 600 // ms between requests

async function rateLimitedGet(url: string, retries = 5): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Throttle requests
    const now = Date.now()
    const timeSinceLastRequest = now - lastRequestTime
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      await sleep(MIN_REQUEST_INTERVAL - timeSinceLastRequest)
    }
    lastRequestTime = Date.now()

    try {
      const res = await axios.get(url, { timeout: 15000 })
      return res.data
    } catch (err: any) {
      if (err.response?.status === 429) {
        const retryAfter = parseInt(err.response.headers?.['retry-after'] || '5', 10)
        const waitTime = Math.min(retryAfter * 1000, 30000)
        console.log(`  ⏳ Rate limit atingido. Aguardando ${waitTime / 1000}s (tentativa ${attempt}/${retries})...`)
        await sleep(waitTime)
        continue
      }
      if (attempt < retries) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 30000)
        console.log(`  ⏳ Erro na requisição. Tentando novamente em ${backoff / 1000}s...`)
        await sleep(backoff)
        continue
      }
      throw err
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Banco ───────────────────────────────────────────────────────────
async function ensureTable(sql: postgres.Sql) {
  console.log('📦 Verificando/criando tabela imported_questions...')

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS imported_questions (
      id SERIAL PRIMARY KEY,
      source VARCHAR(16) NOT NULL DEFAULT 'enem',
      year SMALLINT NOT NULL,
      question_index SMALLINT NOT NULL,
      discipline VARCHAR(64),
      language VARCHAR(32) DEFAULT '',
      title TEXT NOT NULL,
      context TEXT,
      files JSONB DEFAULT '[]'::jsonb,
      correct_alternative CHAR(1) NOT NULL,
      alternatives_introduction TEXT,
      alternatives JSONB NOT NULL,
      raw_json JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)

  try {
    await sql.unsafe(`
      ALTER TABLE imported_questions ADD CONSTRAINT uq_question
      UNIQUE (source, year, question_index, language)
    `)
  } catch (e: unknown) {
    if (e instanceof Error && !e.message.includes('already exists')) {
      throw e
    }
  }

  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_questions_year ON imported_questions (year)`)
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_questions_discipline ON imported_questions (discipline)`)
  await sql.unsafe(`CREATE INDEX IF NOT EXISTS idx_questions_language ON imported_questions (language)`)

  console.log('✅ Tabela garantida com sucesso.')
}

// ── Importação ──────────────────────────────────────────────────────
async function fetchAllQuestionsForYear(sql: postgres.Sql, year: number): Promise<number> {
  console.log(`\n📥 Buscando questões do ENEM ${year}...`)
  let imported = 0
  let offset = 0
  const limit = 50
  let hasMore = true

  while (hasMore) {
    const url = `${ENEM_API_URL}/exams/${year}/questions?limit=${limit}&offset=${offset}`
    const data = await rateLimitedGet(url)
    const { questions, metadata } = data
    hasMore = metadata.hasMore

    if (!questions || questions.length === 0) break

    for (const q of questions as EnemQuestion[]) {
      if (DRY_RUN) {
        console.log(`  [DRY-RUN] Questão ${q.index} - ${q.discipline || 'sem disciplina'} (${q.language || 'sem idioma'})`)
        imported++
        continue
      }

      try {
        await sql`
          INSERT INTO imported_questions
            (source, year, question_index, discipline, language, title,
             context, files, correct_alternative, alternatives_introduction,
             alternatives, raw_json)
          VALUES (
            'enem',
            ${q.year},
            ${q.index},
            ${q.discipline},
            ${q.language || ''},
            ${q.title},
            ${q.context},
            ${sql.json(q.files)},
            ${q.correctAlternative},
            ${q.alternativesIntroduction},
            ${sql.json(q.alternatives)},
            ${sql.json(q)}
          )
          ON CONFLICT ON CONSTRAINT uq_question
          DO UPDATE SET
            title = EXCLUDED.title,
            context = EXCLUDED.context,
            files = EXCLUDED.files,
            correct_alternative = EXCLUDED.correct_alternative,
            alternatives_introduction = EXCLUDED.alternatives_introduction,
            alternatives = EXCLUDED.alternatives,
            raw_json = EXCLUDED.raw_json
        `
        imported++
        if (imported % 20 === 0) {
          process.stdout.write(`  📊 ${imported} questões importadas...\r`)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`\n  ❌ Erro questão ${q.index}/${year}: ${msg}`)
      }
    }

    offset += limit
  }

  return imported
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════')
  console.log('  🎯 Importador de Questões do ENEM')
  console.log('═══════════════════════════════════════════')
  const maskedUrl = DATABASE_URL.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')
  console.log(`  API:     ${ENEM_API_URL}`)
  console.log(`  DB:      ${maskedUrl}`)
  console.log(`  DRY_RUN: ${DRY_RUN ? '✅ Sim' : '❌ Não'}`)
  console.log(`  YEARS:   ${YEARS?.length ? YEARS.join(', ') : 'todos os disponíveis'}`)
  console.log(`  RESUME:  ${RESUME_YEAR ? `até ${RESUME_YEAR} (legado)` : '❌ Não'}`)
  console.log('═══════════════════════════════════════════\n')

  const sql = postgres(DATABASE_URL, {
    ssl: false,
    connect_timeout: 10,
  })

  try {
    await sql`SELECT 1 AS test`
    console.log('✅ Conexão com banco estabelecida.\n')

    await ensureTable(sql)

    const examsRes = await axios.get(`${ENEM_API_URL}/exams`, { timeout: 10000 })
    let exams = examsRes.data as Array<{ title: string; year: number }>

    if (YEARS?.length) {
      exams = exams.filter(e => YEARS.includes(e.year))
      const availableYears = new Set(exams.map((exam) => exam.year))
      const unavailableYears = YEARS.filter((year) => !availableYears.has(year))
      if (unavailableYears.length) {
        throw new Error(
          `A fonte ${ENEM_API_URL} ainda não disponibiliza: ${unavailableYears.join(', ')}. ` +
          'Não foi inserida nenhuma questão; use o importador oficial de provas/gabaritos quando disponível.',
        )
      }
      console.log(`📋 Anos solicitados: ${exams.map(e => e.year).join(', ')}\n`)
    } else if (RESUME_YEAR) {
      // Mantido apenas para compatibilidade com execuções antigas.
      exams = exams.filter(e => e.year <= RESUME_YEAR)
      console.log(`📋 Anos até ${RESUME_YEAR}: ${exams.map(e => e.year).join(', ')}\n`)
    } else {
      console.log(`📋 ${exams.length} provas disponíveis: ${exams.map(e => e.year).join(', ')}\n`)
    }

    let total = 0
    for (const exam of exams) {
      const count = await fetchAllQuestionsForYear(sql, exam.year)
      total += count
      console.log(`  ✅ ENEM ${exam.year}: ${count} questões importadas.`)
    }

    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM imported_questions`

    console.log('\n═══════════════════════════════════════════')
    console.log(`  ✅ Importação concluída!`)
    console.log(`  📊 Total no banco: ${count} questões`)
    if (DRY_RUN) {
      console.log('  ⚠️  Modo DRY_RUN — nenhum dado foi inserido.')
    }
    console.log('═══════════════════════════════════════════')

    const byYear = await sql`SELECT year, COUNT(*)::int AS count FROM imported_questions GROUP BY year ORDER BY year DESC`
    console.log('\n📊 Questões por ano:')
    for (const row of byYear) {
      console.log(`  ${row.year}: ${row.count} questões`)
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`\n❌ Erro: ${msg}`)
    process.exit(1)
  } finally {
    await sql.end()
  }
}

main()
