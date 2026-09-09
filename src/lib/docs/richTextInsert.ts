import type { docs_v1 } from 'googleapis'

export type TextRange = { start: number; end: number }

/**
 * Scans a fetched document for a plain-text marker (e.g. "{{CORPO_PROVA}}")
 * and returns its absolute [start,end) index range. Markers must live in a
 * single text run (no other formatting split across them) — this holds for
 * the seed-templates.ts-authored templates, which write markers as plain
 * unstyled paragraphs.
 */
export function findMarkerRange(document: docs_v1.Schema$Document, marker: string): TextRange | null {
  const content = document.body?.content ?? []
  for (const element of content) {
    const elements = element.paragraph?.elements ?? []
    for (const el of elements) {
      const text = el.textRun?.content
      if (text && el.startIndex != null && text.includes(marker)) {
        const offset = text.indexOf(marker)
        return { start: el.startIndex + offset, end: el.startIndex + offset + marker.length }
      }
    }
  }
  return null
}

/**
 * Replaces a marker range with `bodyText`, then bolds the given ranges
 * (offsets relative to the start of `bodyText`). All indices are computed
 * relative to `markerRange.start`, so this is safe to run as a single
 * batchUpdate — no re-fetch needed between delete/insert/style.
 */
export function buildReplaceMarkerRequests(
  markerRange: TextRange,
  bodyText: string,
  boldRanges: TextRange[] = [],
): docs_v1.Schema$Request[] {
  const requests: docs_v1.Schema$Request[] = [
    { deleteContentRange: { range: { startIndex: markerRange.start, endIndex: markerRange.end } } },
    { insertText: { location: { index: markerRange.start }, text: bodyText } },
  ]

  for (const range of boldRanges) {
    requests.push({
      updateTextStyle: {
        range: { startIndex: markerRange.start + range.start, endIndex: markerRange.start + range.end },
        textStyle: { bold: true },
        fields: 'bold',
      },
    })
  }

  return requests
}
