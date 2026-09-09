import { unlink } from 'fs/promises'
import { archivePrivateScan } from './privateDriveArchive'
import { inspectPrivateImageArtifact, newStagingObjectKey, resolveStagingPath, stageScanFile, type ScanFileInspection } from './scanFile'

export async function stageAndArchivePrivateArtifact(input: {
  bytes: Buffer
  examId: number
  uploadId: number
  artifact: 'canonical_page' | 'reading_crop'
  artifactId: number
  saveStagingKey: (key: string) => Promise<void>
  saveArchived: (result: { driveFileId: string; verifiedSha256: string }, inspection: ScanFileInspection) => Promise<void>
  saveFailure: () => Promise<void>
}) {
  const inspection = await inspectPrivateImageArtifact(input.bytes)
  const stagingObjectKey = newStagingObjectKey(inspection.extension)
  await stageScanFile(input.bytes, stagingObjectKey)
  await input.saveStagingKey(stagingObjectKey)
  try {
    const archived = await archivePrivateScan({
      uploadId: input.uploadId, examId: input.examId, stagingObjectKey, inspection, artifact: input.artifact, artifactId: input.artifactId,
    })
    await unlink(resolveStagingPath(stagingObjectKey))
    await input.saveArchived(archived, inspection)
    return { ...archived, inspection }
  } catch (error) {
    await input.saveFailure()
    throw error
  }
}
