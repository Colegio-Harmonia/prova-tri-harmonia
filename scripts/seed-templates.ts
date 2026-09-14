/**
 * One-time setup: creates the 3 branded Google Docs templates (Prova,
 * Gabarito, Mapa da prova) used as the copy source for every generated
 * exam. Run once, then visually review the 3 docs (logo, A4, green
 * accents) before relying on them — per the deploy checklist.
 *
 * Requires GOOGLE_SERVICE_ACCOUNT_KEY_PATH and DRIVE_ROOT_FOLDER_ID in the
 * environment. Prints the 3 resulting doc IDs to add to .env.local as
 * TEMPLATE_PROVA_DOC_ID / TEMPLATE_GABARITO_DOC_ID / TEMPLATE_MAPA_DOC_ID.
 */
import fs from 'node:fs'
import path from 'node:path'
import { getDriveClient, getDocsClient, findOrCreateFolder } from '../src/lib/docs/driveClient'
import { applyA4PageSize } from '../src/lib/docs/pageSetup'

async function uploadLogo(drive: ReturnType<typeof getDriveClient>, folderId: string): Promise<string> {
  const logoPath = path.resolve(__dirname, '../public/brand/harmonia-logo-color.png')
  const { data } = await drive.files.create({
    requestBody: { name: 'logo-harmonia.png', parents: [folderId] },
    media: { mimeType: 'image/png', body: fs.createReadStream(logoPath) },
    fields: 'id',
    supportsAllDrives: true,
  })
  const fileId = data.id as string

  // insertInlineImage needs a publicly fetchable URI — the logo itself isn't
  // sensitive, so "anyone with the link can view" is an acceptable tradeoff.
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
    supportsAllDrives: true,
  })

  return `https://drive.google.com/uc?id=${fileId}`
}

/**
 * Header layout matches the school's existing paper exam format (logo
 * top-left standalone, then Nome/Nº, Ano/Turma/Bimestre/Data,
 * Professor(a)/Disciplina, then a centered bold assessment title) — not the
 * older green-branded "Colégio Harmonia" heading this replaced.
 */
async function createBrandedDoc(
  drive: ReturnType<typeof getDriveClient>,
  docs: ReturnType<typeof getDocsClient>,
  templatesFolderId: string,
  logoUri: string,
  title: string,
  headerLines: string[],
  titlePlaceholder: string,
  bodyMarker: string,
): Promise<string> {
  // Create via Drive API with `parents` set directly, not
  // docs.documents.create() — a bare service account (no domain-wide
  // delegation) has no Drive storage of its own, so documents.create()
  // (which creates in the caller's own Drive root before any move) fails
  // with 403 "The caller does not have permission". Creating straight into
  // the already-permitted Shared Drive folder works, same as the
  // drive.files.copy() pattern used everywhere else in this codebase.
  const { data: created } = await drive.files.create({
    requestBody: { name: title, mimeType: 'application/vnd.google-apps.document', parents: [templatesFolderId] },
    fields: 'id',
    supportsAllDrives: true,
  })
  const documentId = created.id as string

  await applyA4PageSize(docs, documentId)

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        { insertInlineImage: { location: { index: 1 }, uri: logoUri, objectSize: { width: { magnitude: 70, unit: 'PT' }, height: { magnitude: 70, unit: 'PT' } } } },
      ],
    },
  })

  const { data: afterImage } = await docs.documents.get({ documentId })
  const endIndex = (afterImage.body?.content?.at(-1)?.endIndex ?? 2) - 1

  const headerText = `\n${headerLines.join('\n')}\n\n${titlePlaceholder}\n\n${bodyMarker}\n`
  const titleStart = endIndex + 1 + headerLines.join('\n').length + 2
  const titleEnd = titleStart + titlePlaceholder.length

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        { insertText: { location: { index: endIndex }, text: headerText } },
        {
          updateTextStyle: {
            range: { startIndex: titleStart, endIndex: titleEnd },
            textStyle: { bold: true, fontSize: { magnitude: 13, unit: 'PT' } },
            fields: 'bold,fontSize',
          },
        },
        {
          updateParagraphStyle: {
            range: { startIndex: titleStart, endIndex: titleEnd },
            paragraphStyle: { alignment: 'CENTER' },
            fields: 'alignment',
          },
        },
      ],
    },
  })

  return documentId
}

async function main() {
  const rootId = process.env.DRIVE_ROOT_FOLDER_ID
  if (!rootId) throw new Error('DRIVE_ROOT_FOLDER_ID não configurado')

  const drive = getDriveClient()
  const docs = getDocsClient()

  const templatesFolderId = await findOrCreateFolder(drive, 'Templates', rootId)
  const logoUri = await uploadLogo(drive, templatesFolderId)

  const provaId = await createBrandedDoc(
    drive, docs, templatesFolderId, logoUri,
    'Template - Prova',
    [
      'NOME: _______________________________________     Nº: ______',
      'ANO: {{ANO}} - TURMA: ______    BIMESTRE: {{BIMESTRE}}    DATA: ____/____/______',
      'PROFESSOR(A): _______________________________     DISCIPLINA: {{DISCIPLINA}}',
    ],
    '{{TITULO_PROVA}}',
    '{{CORPO_PROVA}}',
  )

  const gabaritoId = await createBrandedDoc(
    drive, docs, templatesFolderId, logoUri,
    'Template - Gabarito',
    ['ANO: {{ANO}}     DISCIPLINA: {{DISCIPLINA}}     BIMESTRE: {{BIMESTRE}}'],
    '{{TITULO_GABARITO}}',
    '{{CORPO_GABARITO}}',
  )

  const mapaId = await createBrandedDoc(
    drive, docs, templatesFolderId, logoUri,
    'Template - Mapa da prova',
    ['ANO: {{ANO}}     DISCIPLINA: {{DISCIPLINA}}     BIMESTRE: {{BIMESTRE}}'],
    '{{TITULO_MAPA}}',
    '{{TABELA_MAPA}}',
  )

  console.log('\nAdicione ao .env.local:\n')
  console.log(`TEMPLATE_PROVA_DOC_ID=${provaId}`)
  console.log(`TEMPLATE_GABARITO_DOC_ID=${gabaritoId}`)
  console.log(`TEMPLATE_MAPA_DOC_ID=${mapaId}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
