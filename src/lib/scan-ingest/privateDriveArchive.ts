import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { getDriveClient, findOrCreateFolder } from '@/lib/docs/driveClient'
import { resolveStagingPath, type ScanFileInspection } from './scanFile'

export class PrivateScanDriveConfigurationError extends Error {
  constructor() {
    super('SCAN_DRIVE_ROOT_FOLDER_ID não configurado.')
  }
}

export type ArchivePrivateScanInput = {
  uploadId: number
  examId: number
  stagingObjectKey: string
  inspection: ScanFileInspection
  artifact?: 'original' | 'canonical_page' | 'reading_crop'
  artifactId?: number
}

/**
 * Arquiva na raiz dedicada de scans privados. Ao contrário do serviço de
 * imagens pedagógicas, esta função não cria nenhuma permission pública nem
 * devolve URL de preview: o acesso será por rota autenticada posterior.
 */
export async function archivePrivateScan(input: ArchivePrivateScanInput) {
  const rootId = process.env.SCAN_DRIVE_ROOT_FOLDER_ID
  if (!rootId) throw new PrivateScanDriveConfigurationError()

  const drive = getDriveClient()
  const privateRootId = await findOrCreateFolder(drive, 'Scans privados - ProvaTRI', rootId)
  const examFolderId = await findOrCreateFolder(drive, `Prova ${input.examId}`, privateRootId)
  const artifact = input.artifact ?? 'original'
  const artifactId = input.artifactId ?? input.uploadId
  const prefix = artifact === 'original' ? 'scan' : artifact === 'canonical_page' ? 'pagina' : 'recorte'
  const fileName = `${prefix}-${artifactId}-${input.inspection.sha256.slice(0, 16)}.${input.inspection.extension}`
  let driveFileId: string | undefined
  try {
    const { data: created } = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [examFolderId],
        appProperties: { provenance: 'prova-tri-scan', uploadId: String(input.uploadId), artifact, artifactId: String(artifactId) },
      },
      media: { mimeType: input.inspection.mimeType, body: createReadStream(resolveStagingPath(input.stagingObjectKey)) },
      fields: 'id',
      supportsAllDrives: true,
    })
    if (!created.id) throw new Error('O Drive não retornou o identificador do arquivo arquivado.')
    driveFileId = created.id

    const { data: archiveStream } = await drive.files.get(
      { fileId: driveFileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' },
    )
    const hash = createHash('sha256')
    for await (const chunk of archiveStream as AsyncIterable<Buffer>) hash.update(chunk)
    const verifiedSha256 = hash.digest('hex')
    if (verifiedSha256 !== input.inspection.sha256) throw new Error('A verificação do hash do arquivo arquivado falhou.')

    return { driveFileId, verifiedSha256 }
  } catch (error) {
    // Se a cópia recém-criada não passa na própria conferência, ela não deve
    // ficar como objeto órfão no Drive. O staging local permanece para retry.
    if (driveFileId) {
      try {
        await drive.files.delete({ fileId: driveFileId, supportsAllDrives: true })
      } catch {
        // A falha principal ainda é a de arquivamento; a reconciliação futura
        // pode localizar este objeto pelo appProperty uploadId.
      }
    }
    throw error
  }
}
