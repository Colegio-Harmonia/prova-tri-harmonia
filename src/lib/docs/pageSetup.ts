import type { docs_v1 } from 'googleapis'

// A4 in points (595.3pt × 841.9pt). Re-applied on every generated doc as a
// defensive guarantee — Docs API sometimes defaults new/copied docs to
// Letter regardless of the source template's stored page size.
export async function applyA4PageSize(docs: docs_v1.Docs, documentId: string): Promise<void> {
  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          updateDocumentStyle: {
            documentStyle: {
              pageSize: { width: { magnitude: 595.3, unit: 'PT' }, height: { magnitude: 841.9, unit: 'PT' } },
              marginTop: { magnitude: 56.7, unit: 'PT' },
              marginBottom: { magnitude: 56.7, unit: 'PT' },
              marginLeft: { magnitude: 56.7, unit: 'PT' },
              marginRight: { magnitude: 56.7, unit: 'PT' },
            },
            fields: 'pageSize,marginTop,marginBottom,marginLeft,marginRight',
          },
        },
      ],
    },
  })
}
