#!/usr/bin/env tsx
/**
 * Vincula os recortes oficiais revisados às questões ENEM que dependem de
 * imagem. Os arquivos já vivem no Drive compartilhado em `Imagens ENEM/2025`;
 * este script é idempotente e só grava os metadados e o URL de exibição no
 * banco. O texto e o gabarito continuam sendo extraídos do PDF oficial.
 *
 * Uso:
 *   npm run import-enem-official-visuals
 *   APPLY=true npm run import-enem-official-visuals
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
const archiveRoot = process.env.INEP_ARCHIVE_DIR ?? 'referencias/inep/enem-archive'

// Manifesto de ativos já revisados visualmente. IDs são de arquivos públicos
// do Drive institucional, organizados em Imagens ENEM/2025; não são segredos.
const DRIVE_FILE_IDS: Record<number, string> = {
  14: '1yPFQLRGuBOsvMr8XHRkfEQBfMPO-wnD9', 15: '19ZxPBgZQvIL08Ge4tzMhlMeCRndLNGiG',
  22: '1s9Y5n8BUocDpP6ZIfrVUkWCEjHunQN1y', 23: '1FCu3WM1oHGT69fXg9Gmo95u8jKoXL1Ry',
  26: '1v6sT1xzQ_1_owgBZdjMauKQreFQ4bKfP', 31: '1WYzZ8zo9VJhEV-Fp1gzdIw5UZ_kedVUI',
  33: '12l3w5zkeN6h22F7cbpfqMrKcuDlD0717', 34: '1lgDxjnwOUQMSbCmZFwSHgsVUFu6tO0a3',
  45: '16yjhfQpzH19MJKeU0OY5apVsrmFO6ten', 49: '1hbZVNV1-WUYn5-JBVtrNlA60huj5L8qU',
  68: '1PDkVR48U3mXy1eNYgYvDyc5cVr6YNq4o', 77: '1wfRhQEcALJO7YRmPZOmTLdZUVzzkdEqz',
  93: '19OQNu9-8Wqop9pVMaKLAseIXubaS_XcQ', 104: '1AMG8XMIKnbCREwELt2eJbwY4jG8Wur85',
  105: '1_M5GMEsrV7cm_kKdea8wtOlj9McIkHBT', 106: '1rue9aDKAoNaehSt-AomVdUrsYemjWBJO',
  109: '1xTKE2Pg5iNjyixkUqcMTcqyYFujsC5m0', 111: '1Hs2Zm2FNNfT8xRUc1pz6vpA4w1-SOvD7',
  116: '1X4_CD_G6SlMSln79mk3wx9vPh0XN3T8Z', 117: '1In4dsnnPYJgYX6dam4sYResOgk3ypv7X',
  118: '1ITyQd5rjzohgbw-ENOzc0_wSPPfkeBpy', 120: '1HJ5EegbbzVLXQdwwYyqqEMeFGR8GK4fn',
  128: '1f3aSmZ_nupeD0R1GCJdN9Kju9JmuG6td', 130: '12hIxQJtxirEyLzpGpnD24eYTOO1caxAv',
  132: '1QxOvwEIB5-7t0aLVo1120QguFCW3npTt', 135: '15ULO3JWFQ_Vr1DMu9_Krr92rdPpdWAhR',
  136: '1MGqZb_uOWvfCVkPibGBE4jlt2Em4Jo6N', 140: '1VG27S1WXpHR1sJW9C1wdGhE5zrZdI8ZR',
  142: '1j4EMZYW6JmnQFtmyF5SKWQhs-sykSnsX', 147: '1-8A2sCWUFblkPdKjkx-tIF4a4e99xKtR',
  148: '1MTSwTi73DcxIuWgfzN8koVgTZNSMNI9c', 151: '1egmPQmn-nBtQqdY8H4orZW-yWad25P6l',
  155: '16KMgGe_aluYzfIjLd4fggavM-FbzD5gd', 156: '11h8o3VhL6jKmAsVG87urVqTx8usg8UW_',
  159: '1bYX4rMwYThzlIfQcO-yeYpFbjxKWQ5Ow', 160: '1iSKFV3dI79Pt2Q5-wMEKn8T3avUm7bP5',
  163: '1bOV-rkahj9nSenYiv-CBPiIqn0-STVWd', 168: '1ToE9-etnDiMKpdGRjwoWv2J-DjwVaCBy',
  171: '1KHFU3blESPB3S7luNa6DrWxXmL7p95vh', 174: '1xyOReRkz7boPnSzeyC8x_oXQDnClS1Hc',
  177: '1329xnJV4MwjqJoM0cFbN6C0np2HzQ9R9',
}

type Question = {
  year: number; questionIndex: number; discipline: string; language: string; title: string; context: string | null
  correctAlternative: string; alternativesIntroduction: string; alternatives: unknown; rawJson: Record<string, unknown>
}

function extract(): Question[] {
  const output = execFileSync('python3', ['scripts/extract-enem-official-pdfs.py', '--root', archiveRoot, '--years', '2025', '--include-visual'], {
    encoding: 'utf8', maxBuffer: 1024 * 1024 * 20, stdio: ['ignore', 'pipe', 'ignore'],
  })
  const parsed = JSON.parse(output) as { years: Array<{ questions: Question[] }> }
  return parsed.years.flatMap((year) => year.questions).filter((question) => DRIVE_FILE_IDS[question.questionIndex])
}

async function main() {
  const questions = extract()
  if (questions.length !== Object.keys(DRIVE_FILE_IDS).length) throw new Error(`Extração visual incompleta: ${questions.length}/${Object.keys(DRIVE_FILE_IDS).length}.`)
  console.log(`Importador visual ENEM 2025 - ${apply ? 'GRAVAÇÃO' : 'dry-run'} (${questions.length} recortes revisados).`)
  if (!apply) return

  const sql = postgres(databaseUrl!, { ssl: false, connect_timeout: 10 })
  try {
    for (const question of questions) {
      const driveFileId = DRIVE_FILE_IDS[question.questionIndex]
      const previewUrl = `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w800`
      const rawJson = { ...question.rawJson, image: { kind: 'official-visual-crop', driveFileId, previewUrl, folder: 'Imagens ENEM/2025' } }
      await sql`
        INSERT INTO imported_questions (
          source, year, question_index, discipline, language, title, context, files,
          correct_alternative, alternatives_introduction, alternatives, raw_json
        ) VALUES (
          'enem', ${question.year}, ${question.questionIndex}, ${question.discipline}, ${question.language},
          ${question.title}, ${question.context}, ${sql.json([previewUrl])}, ${question.correctAlternative},
          ${question.alternativesIntroduction}, ${sql.json(question.alternatives)}, ${sql.json(rawJson)}
        ) ON CONFLICT ON CONSTRAINT uq_question DO UPDATE SET
          discipline = EXCLUDED.discipline, title = EXCLUDED.title, context = EXCLUDED.context,
          files = EXCLUDED.files, correct_alternative = EXCLUDED.correct_alternative,
          alternatives_introduction = EXCLUDED.alternatives_introduction, alternatives = EXCLUDED.alternatives,
          raw_json = EXCLUDED.raw_json
      `
    }
    console.log(`OK: ${questions.length} questões visuais oficiais gravadas.`)
  } finally { await sql.end() }
}

main().catch((error) => { console.error(`ERRO: ${error instanceof Error ? error.message : error}`); process.exit(1) })
