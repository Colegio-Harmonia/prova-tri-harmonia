import { Readable } from 'stream'
import { execFile } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { PDFDocument } from 'pdf-lib'
import { getDriveClient } from '@/lib/docs/driveClient'

const execFileAsync = promisify(execFile)

export async function downloadPrivateScanBytes(driveFileId: string, maxBytes = 50 * 1024 * 1024) {
  const drive = getDriveClient()
  const { data } = await drive.files.get(
    { fileId: driveFileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' },
  )
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of data as AsyncIterable<Buffer>) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new Error('O arquivo arquivado excede o limite de processamento.')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export async function countLogicalScanPages(driveFileId: string, mimeType: string) {
  if (mimeType !== 'application/pdf') return 1
  const bytes = await downloadPrivateScanBytes(driveFileId)
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false })
  const pageCount = pdf.getPageCount()
  if (pageCount < 1 || pageCount > 500) throw new Error('O PDF precisa conter entre 1 e 500 páginas para o piloto.')
  return pageCount
}

export async function openPrivateScanStream(driveFileId: string) {
  const drive = getDriveClient()
  const { data } = await drive.files.get(
    { fileId: driveFileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' },
  )
  return data as Readable
}

/**
 * O arquivo original pode ser a única evidência disponível quando o OMR falha
 * antes de gerar a imagem canônica. Para PDFs, converte somente a página
 * solicitada em PNG para que a mesma rota possa ser usada por <img>.
 */
export async function renderPrivateScanPdfPage(driveFileId: string, pageIndex: number) {
  if (!Number.isInteger(pageIndex) || pageIndex < 1) throw new Error('Índice de página inválido.')
  const pdfBytes = await downloadPrivateScanBytes(driveFileId)
  const tempDirectory = await mkdtemp(join(tmpdir(), 'prova-tri-scan-preview-'))
  const inputPath = join(tempDirectory, 'scan.pdf')
  const outputRoot = join(tempDirectory, 'page')
  try {
    await writeFile(inputPath, pdfBytes, { mode: 0o600 })
    await execFileAsync(process.env.PDFTOPPM_PATH || 'pdftoppm', [
      '-f', String(pageIndex), '-l', String(pageIndex), '-r', '150', '-png', '-singlefile', inputPath, outputRoot,
    ], { maxBuffer: 1024 * 1024 })
    return await readFile(`${outputRoot}.png`)
  } finally {
    await rm(tempDirectory, { recursive: true, force: true })
  }
}
