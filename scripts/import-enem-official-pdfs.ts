#!/usr/bin/env tsx
/**
 * Importa ao banco as questões textuais verificáveis dos PDFs oficiais do
 * INEP. Questões com imagem/gráfico/tira são deliberadamente excluídas até
 * existir uma forma de servir o recorte visual individual no produto.
 *
 * Uso:
 *   npm run import-enem-official-pdfs                 # dry-run
 *   APPLY=true YEARS=2024,2025 npm run import-enem-official-pdfs
 *   APPLY=true REFRESH_EXISTING_VISUAL=true YEARS=2024,2025 npm run import-enem-official-pdfs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'

function loadDatabaseUrlFromLocalEnv() {
  if (process.env.DATABASE_URL) return
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find((entry) => entry.trim().startsWith('DATABASE_URL='))
  if (line) process.env.DATABASE_URL = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}
loadDatabaseUrlFromLocalEnv()

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL não definida (nem no ambiente, nem em .env.local).')

const apply = process.env.APPLY === 'true'
// Reprocessa também o texto dos itens visuais que já existem no banco, sem
// criar itens visuais sem recorte revisado. Útil para corrigir o parser de
// PDF preservando o arquivo oficial já associado a cada questão.
const refreshExistingVisual = process.env.REFRESH_EXISTING_VISUAL === 'true'
const years = (process.env.YEARS ?? '2024,2025').split(',').map((value) => Number(value.trim())).filter(Number.isInteger)
const archiveRoot = process.env.INEP_ARCHIVE_DIR ?? 'referencias/inep/enem-archive'

type ExtractedQuestion = {
  year: number
  questionIndex: number
  discipline: string
  language: string
  title: string
  context: string | null
  files: string[]
  correctAlternative: string
  alternativesIntroduction: string
  alternatives: Array<{ letter: string; text: string; file: null; isCorrect: boolean }>
  rawJson: Record<string, unknown> & { visualDetected?: boolean }
}
type ExtractedYear = {
  year: number
  answerCount: number
  textCount: number
  visualExcluded: number
  questions: ExtractedQuestion[]
  missingQuestionNumbers: number[]
}

function extract(): ExtractedYear[] {
  const output = execFileSync('python3', [
    'scripts/extract-enem-official-pdfs.py',
    '--root', archiveRoot,
    '--years', years.join(','),
    ...(refreshExistingVisual ? ['--include-visual'] : []),
  ], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
    // Alguns PDFs do INEP têm referências de cor não convencionais; o
    // pdfminer alerta no stderr mas a extração textual segue válida.
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return (JSON.parse(output) as { years: ExtractedYear[] }).years
}

async function main() {
  console.log(`Importador oficial INEP (PDF) — ${apply ? 'GRAVAÇÃO' : 'dry-run'}${refreshExistingVisual ? ' (inclui atualização dos visuais já existentes)' : ''}`)
  const extracted = extract()
  for (const result of extracted) {
    console.log(`${result.year}: ${result.questions.length} textuais elegíveis; ${result.visualExcluded} com visual preservados fora do banco; ${result.missingQuestionNumbers.length} não extraídos.`)
    if (result.answerCount < 175) throw new Error(`Gabarito ${result.year} incompleto (${result.answerCount} respostas lidas).`)
    if (result.questions.length < 20) throw new Error(`Extração ${result.year} insuficiente (${result.questions.length} questões textuais).`)
  }
  if (!apply) return

  const sql = postgres(databaseUrl!, { ssl: false, connect_timeout: 10 })
  try {
    let written = 0
    let refreshedVisuals = 0
    for (const result of extracted) {
      for (const question of result.questions) {
        if (refreshExistingVisual && question.rawJson.visualDetected) {
          // Não faz INSERT: um visual sem arquivo revisado não pode voltar ao
          // banco. Quando a linha já existe, corrige somente o texto e mantém
          // a URL/metadata do recorte oficial armazenado anteriormente.
          const updated = await sql`
            UPDATE imported_questions SET
              discipline = ${question.discipline}, title = ${question.title}, context = ${question.context},
              correct_alternative = ${question.correctAlternative}, alternatives_introduction = ${question.alternativesIntroduction},
              alternatives = ${sql.json(question.alternatives)},
              raw_json = ${sql.json(question.rawJson)}::jsonb ||
                CASE WHEN imported_questions.raw_json ? 'image'
                  THEN jsonb_build_object('image', imported_questions.raw_json->'image')
                  ELSE '{}'::jsonb
                END
            WHERE source = 'enem' AND year = ${question.year} AND question_index = ${question.questionIndex}
          `
          refreshedVisuals += updated.count
          continue
        }
        await sql`
          INSERT INTO imported_questions (
            source, year, question_index, discipline, language, title, context, files,
            correct_alternative, alternatives_introduction, alternatives, raw_json
          ) VALUES (
            'enem', ${question.year}, ${question.questionIndex}, ${question.discipline}, ${question.language},
            ${question.title}, ${question.context}, ${sql.json(question.files)}, ${question.correctAlternative},
            ${question.alternativesIntroduction}, ${sql.json(question.alternatives)}, ${sql.json(question.rawJson)}
          ) ON CONFLICT ON CONSTRAINT uq_question DO UPDATE SET
            discipline = EXCLUDED.discipline,
            title = EXCLUDED.title,
            context = EXCLUDED.context,
            files = EXCLUDED.files,
            correct_alternative = EXCLUDED.correct_alternative,
            alternatives_introduction = EXCLUDED.alternatives_introduction,
            alternatives = EXCLUDED.alternatives,
            raw_json = EXCLUDED.raw_json
        `
        written++
      }
    }
    console.log(`✅ ${written} questões oficiais textuais gravadas; ${refreshedVisuals} visuais existentes tiveram o texto atualizado.`)
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(`❌ ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
