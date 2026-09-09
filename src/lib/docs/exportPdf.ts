import { Readable } from 'node:stream'
import { getDriveClient } from './driveClient'

// Export de um Google Doc como PDF pro anexo do Classroom (Módulo 3):
// PDF congela a diagramação pro aluno (o Doc continua editável pra
// escola). O arquivo nasce no Drive do service account — a permissão de
// leitura pro domínio é obrigatória, senão o anexo aparece quebrado pros
// alunos no Classroom.

export async function exportDocAsPdf(params: {
  docId: string
  pdfName: string
  parentFolderId?: string | null
  shareWithDomain: string
}): Promise<{ pdfFileId: string }> {
  const drive = getDriveClient()

  const exported = await drive.files.export(
    { fileId: params.docId, mimeType: 'application/pdf' },
    { responseType: 'arraybuffer' },
  )

  const { data: created } = await drive.files.create({
    requestBody: {
      name: params.pdfName,
      mimeType: 'application/pdf',
      ...(params.parentFolderId ? { parents: [params.parentFolderId] } : {}),
    },
    media: {
      mimeType: 'application/pdf',
      body: Readable.from(Buffer.from(exported.data as ArrayBuffer)),
    },
    fields: 'id',
    supportsAllDrives: true,
  })
  const pdfFileId = created.id as string

  await drive.permissions.create({
    fileId: pdfFileId,
    requestBody: { role: 'reader', type: 'domain', domain: params.shareWithDomain },
    supportsAllDrives: true,
  })

  return { pdfFileId }
}
