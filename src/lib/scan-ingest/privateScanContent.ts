import { Readable } from 'stream'
import { PDFDocument } from 'pdf-lib'
import { getDriveClient } from '@/lib/docs/driveClient'

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
