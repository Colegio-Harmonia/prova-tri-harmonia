#!/usr/bin/env tsx
/**
 * Publica no Drive os recortes visuais extraídos diretamente dos PDFs
 * oficiais e cria/atualiza os itens ENEM correspondentes no banco.
 *
 * Uso:
 *   YEARS=2024 npm run import-enem-official-pdf-crops
 *   APPLY=true YEARS=2024 npm run import-enem-official-pdf-crops
 */
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import postgres from 'postgres'
import { findOrCreateFolder, getDriveClient } from '../src/lib/docs/driveClient'

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)$/)
    if (!match || process.env[match[1]] !== undefined) continue
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
}

loadLocalEnv()

const databaseUrl = process.env.DATABASE_URL
const driveRootId = process.env.DRIVE_ROOT_FOLDER_ID
const driveImagesFolderId = process.env.DRIVE_ENEM_IMAGES_FOLDER_ID
if (!databaseUrl) throw new Error('DATABASE_URL não definida (nem no ambiente, nem em .env.local).')

const apply = process.env.APPLY === 'true'
const years = (process.env.YEARS ?? '2024').split(',').map(Number).filter(Number.isInteger)
const archiveRoot = process.env.INEP_ARCHIVE_DIR ?? 'referencias/inep/enem-archive'
const cropRoot = process.env.ENEM_VISUAL_CROP_DIR ?? 'referencias/inep/enem-visual-crops'

type ExtractedQuestion = {
  year: number; questionIndex: number; discipline: string; language: string; title: string; context: string | null
  correctAlternative: string; alternativesIntroduction: string
  alternatives: Array<{ letter: string; text: string; file: null; isCorrect: boolean }>
  rawJson: Record<string, unknown>
}
type Crop = { questionIndex: number; files: string[]; fullQuestionFile?: string | null }

function extractQuestions(): { questions: ExtractedQuestion[]; incompleteVisualQuestions: ExtractedQuestion[] } {
  const output = execFileSync('python3', ['scripts/extract-enem-official-pdfs.py', '--root', archiveRoot, '--years', years.join(','), '--include-visual'], {
    encoding: 'utf8', maxBuffer: 1024 * 1024 * 30, stdio: ['ignore', 'pipe', 'ignore'],
  })
  const parsed = JSON.parse(output) as { years: Array<{ questions: ExtractedQuestion[]; incompleteVisualQuestions?: ExtractedQuestion[] }> }
  return {
    questions: parsed.years.flatMap((year) => year.questions),
    incompleteVisualQuestions: parsed.years.flatMap((year) => year.incompleteVisualQuestions ?? []),
  }
}

function extractCrops(fullQuestionNumbers: number[]): Array<{ year: number; crops: Crop[] }> {
  const args = ['scripts/export-enem-official-visual-crops.py', '--root', archiveRoot, '--output', cropRoot, '--years', years.join(',')]
  if (fullQuestionNumbers.length) args.push('--full-question-numbers', fullQuestionNumbers.join(','))
  const output = execFileSync('python3', args, {
    encoding: 'utf8', maxBuffer: 1024 * 1024 * 30, stdio: ['ignore', 'pipe', 'ignore'],
  })
  const parsed = JSON.parse(output) as { years: Array<{ year: number; questions: Crop[] }> }
  return parsed.years.map((year) => ({ year: year.year, crops: year.questions }))
}

async function existingDriveFileId(name: string, parentId: string): Promise<string | null> {
  const drive = getDriveClient()
  const escaped = name.replace(/'/g, "\\'")
  const { data } = await drive.files.list({
    q: `name='${escaped}' and trashed=false and '${parentId}' in parents`,
    fields: 'files(id)', pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true,
  })
  return data.files?.[0]?.id ?? null
}

async function uploadCrop(filePath: string, parentId: string): Promise<{ driveFileId: string; previewUrl: string }> {
  const drive = getDriveClient()
  const name = path.basename(filePath)
  const existing = await existingDriveFileId(name, parentId)
  if (existing) return { driveFileId: existing, previewUrl: `https://drive.google.com/thumbnail?id=${existing}&sz=w1200` }
  const { data } = await drive.files.create({
    requestBody: { name, parents: [parentId] }, media: { mimeType: 'image/png', body: createReadStream(filePath) },
    fields: 'id', supportsAllDrives: true,
  })
  const driveFileId = data.id
  if (!driveFileId) throw new Error(`Drive não devolveu id para ${name}.`)
  await drive.permissions.create({ fileId: driveFileId, requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true })
  return { driveFileId, previewUrl: `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w1200` }
}

async function main() {
  const extracted = extractQuestions()
  const questionByKey = new Map(extracted.questions.map((question) => [`${question.year}/${question.questionIndex}`, question]))
  const incompleteByKey = new Map(extracted.incompleteVisualQuestions.map((question) => [`${question.year}/${question.questionIndex}`, question]))
  const cropYears = extractCrops(extracted.incompleteVisualQuestions.map((question) => question.questionIndex))
  const total = cropYears.reduce((sum, year) => sum + year.crops.length, 0)
  console.log(`Importador de recortes oficiais — ${apply ? 'GRAVAÇÃO' : 'dry-run'}; ${total} questões visuais (${years.join(', ')}).`)
  if (!apply) return
  if (!driveImagesFolderId && !driveRootId) {
    throw new Error('DRIVE_ENEM_IMAGES_FOLDER_ID ou DRIVE_ROOT_FOLDER_ID não configurado.')
  }

  const sql = postgres(databaseUrl!, { ssl: false, connect_timeout: 10 })
  try {
    const drive = getDriveClient()
    // Prefira o diretório canônico já existente para não aninhar pastas com o
    // mesmo nome em execuções futuras.
    const imagesRootId = driveImagesFolderId ?? await findOrCreateFolder(drive, 'Imagens ENEM', driveRootId!)
    let imported = 0
    const failures: string[] = []
    for (const cropYear of cropYears) {
      const yearFolderId = await findOrCreateFolder(drive, String(cropYear.year), imagesRootId)
      for (const crop of cropYear.crops) {
        const key = `${cropYear.year}/${crop.questionIndex}`
        const fallback = incompleteByKey.get(key)
        const question = questionByKey.get(key) ?? fallback
        if (!question) {
          failures.push(`${cropYear.year}/${crop.questionIndex}: texto/gabarito não extraído`)
          continue
        }
        try {
          const assets = [] as Array<{ driveFileId: string; previewUrl: string }>
          const assetFiles = fallback && crop.fullQuestionFile ? [crop.fullQuestionFile] : crop.files
          for (const filePath of assetFiles) assets.push(await uploadCrop(filePath, yearFolderId))
          const rawJson = {
            ...question.rawJson,
            image: {
              kind: fallback ? 'official-pdf-full-question-crop' : 'official-pdf-crop', folder: `Imagens ENEM/${cropYear.year}`,
              driveFileIds: assets.map((asset) => asset.driveFileId), previewUrls: assets.map((asset) => asset.previewUrl),
            },
          }
          await sql`
            INSERT INTO imported_questions (
              source, year, question_index, discipline, language, title, context, files,
              correct_alternative, alternatives_introduction, alternatives, raw_json
            ) VALUES (
              'enem', ${question.year}, ${question.questionIndex}, ${question.discipline}, ${question.language},
              ${question.title}, ${question.context}, ${sql.json(assets.map((asset) => asset.previewUrl))},
              ${question.correctAlternative}, ${question.alternativesIntroduction}, ${sql.json(question.alternatives)}, ${sql.json(rawJson)}
            ) ON CONFLICT ON CONSTRAINT uq_question DO UPDATE SET
              discipline = EXCLUDED.discipline, title = EXCLUDED.title, context = EXCLUDED.context,
              files = EXCLUDED.files, correct_alternative = EXCLUDED.correct_alternative,
              alternatives_introduction = EXCLUDED.alternatives_introduction, alternatives = EXCLUDED.alternatives,
              raw_json = EXCLUDED.raw_json
          `
          imported++
          console.log(`OK ${cropYear.year}/${crop.questionIndex} (${assets.length} recorte${assets.length === 1 ? '' : 's'})`)
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          failures.push(`${cropYear.year}/${crop.questionIndex}: ${reason}`)
          console.error(`ERRO ${cropYear.year}/${crop.questionIndex}: ${reason}`)
        }
      }
    }
    console.log(`Concluído: ${imported} questão(ões) visuais importada(s); ${failures.length} falha(s).`)
    if (failures.length) process.exitCode = 2
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(`ERRO: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
