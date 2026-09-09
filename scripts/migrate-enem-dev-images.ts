#!/usr/bin/env tsx
/**
 * Migra para o Drive institucional os ativos visuais oficiais que o banco
 * histórico do ENEM (2009–2023) referencia em enem.dev.
 *
 * O script preserva a URL de origem em raw_json, publica uma thumbnail do
 * Drive em `files` e remove somente o Markdown de imagem do texto. Assim a
 * questão continua verificável, fica independente do host externo e volta a
 * ser elegível para o Reforço ENEM.
 *
 * Uso:
 *   YEARS=2009 npm run migrate-enem-dev-images
 *   APPLY=true YEARS=2009,2010 npm run migrate-enem-dev-images
 *   APPLY=true YEARS=2009-2023 npm run migrate-enem-dev-images
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import axios from 'axios'
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
const maxItems = Number(process.env.LIMIT ?? 0)
const maxBytes = 15 * 1024 * 1024

function parseYears(value: string | undefined): number[] {
  const raw = value?.trim() || '2009-2023'
  const years = new Set<number>()
  for (const part of raw.split(',')) {
    const [fromText, toText] = part.trim().split('-', 2)
    const from = Number(fromText)
    const to = toText ? Number(toText) : from
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 2009 || to > 2023 || to < from) {
      throw new Error(`YEARS inválido: "${part}". Use, por exemplo, 2009,2010 ou 2009-2023.`)
    }
    for (let year = from; year <= to; year++) years.add(year)
  }
  return [...years].sort((a, b) => a - b)
}

const years = parseYears(process.env.YEARS)

type Asset = { sourceUrl: string; driveFileId: string; previewUrl: string }
type ImportedQuestion = {
  id: number
  year: number
  questionIndex: number
  files: string[]
  context: string | null
  alternativesIntroduction: string | null
  alternatives: unknown
  rawJson: Record<string, unknown> | null
}

function stripImageMarkdown(value: string | null): string | null {
  if (value == null) return null
  const cleaned = value
    .replace(/!\[[^\]]*]\(<?https?:\/\/[^\s)>]+>?\)/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return cleaned || null
}

function stripImagesFromAlternatives(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((alternative) => {
    if (!alternative || typeof alternative !== 'object') return alternative
    const record = alternative as Record<string, unknown>
    return typeof record.text === 'string' ? { ...record, text: stripImageMarkdown(record.text) ?? '' } : record
  })
}

function isMigrated(rawJson: Record<string, unknown> | null): boolean {
  const image = rawJson?.image
  return Boolean(image && typeof image === 'object' && (image as Record<string, unknown>).kind === 'official-enem-dev-migrated')
}

function deterministicName(questionIndex: number, assetIndex: number, sourceUrl: string, extension: string): string {
  const digest = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 12)
  return `q${String(questionIndex).padStart(3, '0')}-${String(assetIndex + 1).padStart(2, '0')}-${digest}.${extension}`
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

async function uploadAsset(sourceUrl: string, name: string, parentId: string): Promise<Asset> {
  const drive = getDriveClient()
  const cachedId = await existingDriveFileId(name, parentId)
  if (cachedId) return { sourceUrl, driveFileId: cachedId, previewUrl: `https://drive.google.com/thumbnail?id=${cachedId}&sz=w1200` }

  const { data, headers } = await axios.get<ArrayBuffer>(sourceUrl, {
    responseType: 'arraybuffer', timeout: 20_000, maxContentLength: maxBytes, maxRedirects: 3,
    headers: { 'User-Agent': 'ProvaTRI/1.0 (asset preservation)' },
  })
  const contentType = String(headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  if (!contentType.startsWith('image/')) throw new Error(`origem não retornou imagem (${contentType || 'sem content-type'})`)
  if (data.byteLength > maxBytes) throw new Error(`imagem excede ${maxBytes / 1024 / 1024} MB`)

  const { data: created } = await drive.files.create({
    requestBody: { name, parents: [parentId] },
    media: { mimeType: contentType, body: Readable.from(Buffer.from(data)) },
    fields: 'id', supportsAllDrives: true,
  })
  const driveFileId = created.id
  if (!driveFileId) throw new Error('Drive não devolveu o identificador do arquivo.')
  await drive.permissions.create({
    fileId: driveFileId, requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true,
  })
  return { sourceUrl, driveFileId, previewUrl: `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w1200` }
}

async function main() {
  const sql = postgres(databaseUrl!, { ssl: false, connect_timeout: 10 })
  try {
    const rows = await sql<ImportedQuestion[]>`
      SELECT id, year, question_index AS "questionIndex", files, context,
        alternatives_introduction AS "alternativesIntroduction", alternatives,
        raw_json AS "rawJson"
      FROM imported_questions
      WHERE source = 'enem'
        AND year IN (${sql.unsafe(years.join(','))})
        AND jsonb_array_length(COALESCE(files, '[]'::jsonb)) > 0
      ORDER BY year, question_index
    `
    const pending = rows.filter((row) => !isMigrated(row.rawJson))
    const selected = maxItems > 0 ? pending.slice(0, maxItems) : pending
    console.log(`Migração de imagens ENEM — ${apply ? 'GRAVAÇÃO' : 'dry-run'}; ${selected.length}/${rows.length} questões pendentes (${years.join(', ')}).`)
    if (!apply) return
    if (!driveImagesFolderId && !driveRootId) {
      throw new Error('DRIVE_ENEM_IMAGES_FOLDER_ID ou DRIVE_ROOT_FOLDER_ID não configurado.')
    }

    const drive = getDriveClient()
    // O diretório canônico evita criar uma pasta "Imagens ENEM" dentro de outra
    // pasta homônima quando o Drive compartilhado já estiver organizado.
    const imagesRootId = driveImagesFolderId ?? await findOrCreateFolder(drive, 'Imagens ENEM', driveRootId!)
    const folders = new Map<number, string>()
    let migrated = 0
    const failures: Array<{ year: number; index: number; reason: string }> = []

    for (const row of selected) {
      try {
        let yearFolderId = folders.get(row.year)
        if (!yearFolderId) {
          yearFolderId = await findOrCreateFolder(drive, String(row.year), imagesRootId)
          folders.set(row.year, yearFolderId)
        }
        const assets: Asset[] = []
        for (const [assetIndex, sourceUrl] of row.files.entries()) {
          const previewMime = sourceUrl.match(/\.([a-z0-9]{2,5})(?:$|[?#])/i)?.[1] ?? 'png'
          const name = deterministicName(row.questionIndex, assetIndex, sourceUrl, previewMime === 'jpeg' ? 'jpg' : previewMime)
          assets.push(await uploadAsset(sourceUrl, name, yearFolderId))
        }
        const rawJson = {
          ...(row.rawJson ?? {}),
          image: {
            kind: 'official-enem-dev-migrated',
            folder: `Imagens ENEM/${row.year}`,
            originalUrls: row.files,
            assets,
          },
        }
        await sql`
          UPDATE imported_questions SET
            files = ${sql.json(assets.map((asset) => asset.previewUrl))},
            context = ${stripImageMarkdown(row.context)},
            alternatives_introduction = ${stripImageMarkdown(row.alternativesIntroduction)},
            alternatives = ${sql.json(stripImagesFromAlternatives(row.alternatives))},
            raw_json = ${sql.json(rawJson)}
          WHERE id = ${row.id}
        `
        migrated++
        console.log(`OK ${row.year}/${row.questionIndex} (${assets.length} ativo${assets.length === 1 ? '' : 's'})`)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        failures.push({ year: row.year, index: row.questionIndex, reason })
        console.error(`ERRO ${row.year}/${row.questionIndex}: ${reason}`)
      }
    }
    console.log(`Concluído: ${migrated} questão(ões) migrada(s); ${failures.length} falha(s).`)
    if (failures.length) process.exitCode = 2
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(`ERRO: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
