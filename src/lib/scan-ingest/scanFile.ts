import { createHash, randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { resolve, sep } from 'path'
import sharp from 'sharp'

export const MAX_SCAN_UPLOAD_BYTES = 50 * 1024 * 1024

export type ScanFileInspection = {
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'
  extension: 'pdf' | 'jpg' | 'png'
  sha256: string
  byteSize: number
  technicalMetadata: Record<string, number | string | null>
}

export class ScanFileValidationError extends Error {}
export class ScanStagingConfigurationError extends Error {}

export function sniffScanMimeType(bytes: Buffer): Pick<ScanFileInspection, 'mimeType' | 'extension'> | null {
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return { mimeType: 'application/pdf', extension: 'pdf' }
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mimeType: 'image/png', extension: 'png' }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mimeType: 'image/jpeg', extension: 'jpg' }
  return null
}

export async function inspectScanFile(bytes: Buffer): Promise<ScanFileInspection> {
  if (bytes.length === 0) throw new ScanFileValidationError('O arquivo está vazio.')
  if (bytes.length > MAX_SCAN_UPLOAD_BYTES) throw new ScanFileValidationError('O scan ultrapassa o limite de 50 MB.')
  const kind = sniffScanMimeType(bytes)
  if (!kind) throw new ScanFileValidationError('Envie um PDF, PNG ou JPEG produzido pelo scanner. HEIC e fotos de celular não são aceitos no piloto.')

  let technicalMetadata: Record<string, number | string | null> = { source: kind.mimeType === 'application/pdf' ? 'pdf' : 'image' }
  if (kind.mimeType !== 'application/pdf') {
    try {
      const metadata = await sharp(bytes, { failOn: 'error' }).metadata()
      if (!metadata.width || !metadata.height || metadata.width < 1200 || metadata.height < 1200) {
        throw new ScanFileValidationError('A imagem do scan precisa ter ao menos 1200 px em cada lado.')
      }
      technicalMetadata = {
        source: 'image',
        width: metadata.width,
        height: metadata.height,
        density: metadata.density ?? null,
        format: metadata.format ?? null,
      }
    } catch (error) {
      if (error instanceof ScanFileValidationError) throw error
      throw new ScanFileValidationError('Não foi possível validar a imagem do scan.')
    }
  }

  return {
    ...kind,
    byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    technicalMetadata,
  }
}

/** Validação para imagens derivadas pelo worker. Recortes podem ser menores
 * que a página scanner, mas continuam limitados, identificados por magic byte
 * e decodificados pelo Sharp antes de entrar no staging privado. */
export async function inspectPrivateImageArtifact(bytes: Buffer): Promise<ScanFileInspection> {
  if (bytes.length === 0) throw new ScanFileValidationError('A imagem está vazia.')
  if (bytes.length > MAX_SCAN_UPLOAD_BYTES) throw new ScanFileValidationError('A imagem ultrapassa o limite de 50 MB.')
  const kind = sniffScanMimeType(bytes)
  if (!kind || kind.mimeType === 'application/pdf') throw new ScanFileValidationError('Envie uma imagem PNG ou JPEG.')
  try {
    const metadata = await sharp(bytes, { failOn: 'error' }).metadata()
    if (!metadata.width || !metadata.height) throw new ScanFileValidationError('Não foi possível ler as dimensões da imagem.')
    return {
      ...kind,
      byteSize: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      technicalMetadata: { source: 'worker_image', width: metadata.width, height: metadata.height, format: metadata.format ?? null },
    }
  } catch (error) {
    if (error instanceof ScanFileValidationError) throw error
    throw new ScanFileValidationError('Não foi possível validar a imagem enviada pelo worker.')
  }
}

function stagingDirectory(rawDirectory = process.env.SCAN_STAGING_DIR) {
  if (!rawDirectory) throw new ScanStagingConfigurationError('SCAN_STAGING_DIR não configurado.')
  return resolve(rawDirectory)
}

export function newStagingObjectKey(extension: ScanFileInspection['extension']) {
  return `scan-${randomUUID()}.${extension}`
}

export function resolveStagingPath(objectKey: string, rawDirectory?: string) {
  if (!/^scan-[0-9a-f-]{36}\.(pdf|png|jpg)$/.test(objectKey)) throw new Error('Chave de staging inválida.')
  const directory = stagingDirectory(rawDirectory)
  const path = resolve(directory, objectKey)
  if (!path.startsWith(`${directory}${sep}`)) throw new Error('Caminho de staging inválido.')
  return path
}

export async function stageScanFile(bytes: Buffer, objectKey: string, rawDirectory?: string) {
  const path = resolveStagingPath(objectKey, rawDirectory)
  await mkdir(stagingDirectory(rawDirectory), { recursive: true, mode: 0o700 })
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
  return path
}
