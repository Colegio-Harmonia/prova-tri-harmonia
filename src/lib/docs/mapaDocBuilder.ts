import type { docs_v1 } from 'googleapis'
import type { ExamGenerationResult, ExamQuestion } from '@/lib/gemini/examSchema'
import { findMarkerRange } from './richTextInsert'
import type { AssessmentMeta } from './assessmentMeta'

const HEADER = ['Nº', 'Disciplina', 'Código BNCC', 'Habilidade', 'Bloom', 'SAEB/ENEM', 'Tipo']

function saebCellValue(q: ExamQuestion): string {
  if (!q.saeb.applicable) return 'N/A'
  const value = q.saeb.value ?? '—'
  return q.saeb.approximate ? `${value} (aproximado)` : value
}

function rowValues(q: ExamQuestion, subject: string): string[] {
  return [
    String(q.number),
    subject,
    q.bnccStatus === 'mapeado' && q.bnccCodes.length ? q.bnccCodes.join(', ') : 'não mapeado na planilha de origem',
    q.bnccSummary ?? '—',
    q.bloomLevel,
    saebCellValue(q),
    q.type,
  ]
}

/**
 * Docs API quirk: insertTable doesn't return per-cell text indices in the
 * same call, so this is 2-phase — insert the table, documents.get to read
 * back real cell startIndex values, then a second batchUpdate with
 * insertText per cell (processed in REVERSE document order, since inserting
 * text into an earlier cell shifts every index after it).
 */
export async function applyMapaContent(
  docs: docs_v1.Docs,
  documentId: string,
  exam: ExamGenerationResult,
  meta: AssessmentMeta,
): Promise<void> {
  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        { replaceAllText: { containsText: { text: '{{ANO}}', matchCase: true }, replaceText: meta.ano } },
        { replaceAllText: { containsText: { text: '{{BIMESTRE}}', matchCase: true }, replaceText: meta.bimestre } },
        { replaceAllText: { containsText: { text: '{{DISCIPLINA}}', matchCase: true }, replaceText: meta.disciplina } },
        { replaceAllText: { containsText: { text: '{{TITULO_MAPA}}', matchCase: true }, replaceText: meta.tituloMapa } },
      ],
    },
  })

  const { data: docBeforeTable } = await docs.documents.get({ documentId })
  const markerRange = findMarkerRange(docBeforeTable, '{{TABELA_MAPA}}')
  if (!markerRange) throw new Error('Marcador {{TABELA_MAPA}} não encontrado no template do Mapa da prova.')

  const rows = exam.questions.length + 1
  const columns = HEADER.length

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        { deleteContentRange: { range: { startIndex: markerRange.start, endIndex: markerRange.end } } },
        { insertTable: { location: { index: markerRange.start }, rows, columns } },
      ],
    },
  })

  const { data: docWithTable } = await docs.documents.get({ documentId })
  const table = docWithTable.body?.content?.find((el) => el.table)?.table
  if (!table?.tableRows) throw new Error('Tabela do Mapa da prova não foi encontrada após a inserção.')

  const values = [HEADER, ...exam.questions.map((q) => rowValues(q, meta.disciplina))]

  const cellInserts: { index: number; text: string }[] = []
  table.tableRows.forEach((row, rowIdx) => {
    row.tableCells?.forEach((cell, colIdx) => {
      const cellStartIndex = cell.content?.[0]?.startIndex
      const text = values[rowIdx]?.[colIdx]
      if (cellStartIndex != null && text) cellInserts.push({ index: cellStartIndex, text })
    })
  })

  // Reverse document order so earlier insertions never invalidate the index
  // of a cell we haven't processed yet.
  cellInserts.sort((a, b) => b.index - a.index)

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: cellInserts.map((c) => ({ insertText: { location: { index: c.index }, text: c.text } })),
    },
  })
}
