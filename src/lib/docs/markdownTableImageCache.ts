import sharp from 'sharp'
import { uploadToStaging } from '@/lib/images/questionImageService'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

const TABLE_DPI = 150
const PT_PER_PX = 72 / TABLE_DPI
const MAX_TABLE_WIDTH_PX = 1_200
const MIN_COLUMN_WIDTH_PX = 130
const MAX_COLUMN_WIDTH_PX = 360
const CELL_PADDING_PX = 18
const FONT_SIZE_PX = 20
const LINE_HEIGHT_PX = 28

export type MarkdownTable = {
  raw: string
  header: string[]
  rows: string[][]
}

export type MarkdownBlock =
  | { kind: 'text'; text: string }
  | { kind: 'table'; table: MarkdownTable }

export type MarkdownTableImageInfo = {
  driveFileId: string
  widthPt: number
  heightPt: number
}

export type MarkdownTableImageCache = Map<string, MarkdownTableImageInfo>

function parseCells(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return null

  const withoutEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  const cells = withoutEdges.split('|').map((cell) => cell.trim())
  return cells.length >= 2 && cells.every((cell) => cell.length > 0) ? cells : null
}

function isDivider(cells: string[], columnCount: number): boolean {
  return cells.length === columnCount && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function normalizeRow(cells: string[], columnCount: number): string[] {
  if (cells.length === columnCount) return cells
  if (cells.length < columnCount) return [...cells, ...Array(columnCount - cells.length).fill('')]
  return [...cells.slice(0, columnCount - 1), cells.slice(columnCount - 1).join(' | ')]
}

/**
 * Aceita Markdown completo e a variante comum que a IA usa sem a linha `---`.
 * Nesta variante, exige cabecalho mais pelo menos duas linhas com o mesmo
 * numero de colunas para nao confundir uma frase isolada com tabela.
 */
export function splitMarkdownTables(text: string | null | undefined): MarkdownBlock[] {
  const lines = (text ?? '').split('\n')
  const blocks: MarkdownBlock[] = []
  const textLines: string[] = []

  const flushText = (appendNewline = false) => {
    if (textLines.length === 0) return
    blocks.push({ kind: 'text', text: `${textLines.join('\n')}${appendNewline ? '\n' : ''}` })
    textLines.length = 0
  }

  for (let index = 0; index < lines.length;) {
    const header = parseCells(lines[index])
    const divider = parseCells(lines[index + 1] ?? '')
    if (!header) {
      textLines.push(lines[index])
      index += 1
      continue
    }

    const hasDivider = Boolean(divider && isDivider(divider, header.length))
    const rows: string[][] = []
    let end = index + (hasDivider ? 2 : 1)
    while (end < lines.length) {
      const parsed = parseCells(lines[end])
      if (!parsed || parsed.length !== header.length) break
      rows.push(normalizeRow(parsed, header.length))
      end += 1
    }

    if (rows.length === 0 || (!hasDivider && rows.length < 2)) {
      textLines.push(lines[index])
      index += 1
      continue
    }

    flushText(textLines.length > 0)
    blocks.push({
      kind: 'table',
      table: {
        raw: lines.slice(index, end).join('\n'),
        header,
        rows,
      },
    })
    index = end
  }

  flushText()
  return blocks
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function wrapCell(value: string, widthPx: number): string[] {
  const maxChars = Math.max(12, Math.floor((widthPx - (CELL_PADDING_PX * 2)) / 10))
  const lines: string[] = []

  for (const paragraph of value.replace(/\s+/g, ' ').trim().split('\n')) {
    const words = paragraph.split(' ').filter(Boolean)
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (candidate.length <= maxChars || !current) {
        current = candidate
      } else {
        lines.push(current)
        current = word
      }
    }
    if (current) lines.push(current)
  }

  return lines.length > 0 ? lines : ['']
}

function columnWidths(table: MarkdownTable): number[] {
  const allRows = [table.header, ...table.rows]
  const requested = table.header.map((_, columnIndex) => {
    const longest = Math.max(...allRows.map((row) => (row[columnIndex] ?? '').length))
    return Math.min(MAX_COLUMN_WIDTH_PX, Math.max(MIN_COLUMN_WIDTH_PX, (longest * 10) + (CELL_PADDING_PX * 2)))
  })
  const requestedTotal = requested.reduce((total, width) => total + width, 0)
  if (requestedTotal <= MAX_TABLE_WIDTH_PX) return requested

  const scale = MAX_TABLE_WIDTH_PX / requestedTotal
  return requested.map((width) => Math.max(MIN_COLUMN_WIDTH_PX, Math.floor(width * scale)))
}

function renderTableSvg(table: MarkdownTable): { svg: string; width: number; height: number } {
  const widths = columnWidths(table)
  const width = widths.reduce((total, value) => total + value, 0)
  const rows = [table.header, ...table.rows]
  const wrappedRows = rows.map((row) => row.map((cell, index) => wrapCell(cell, widths[index])))
  const heights = wrappedRows.map((cells) => Math.max(...cells.map((cell) => (cell.length * LINE_HEIGHT_PX) + (CELL_PADDING_PX * 2))))
  const height = heights.reduce((total, value) => total + value, 0) + 2

  let y = 1
  const fragments = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    '<style>text{font-family:Arial,Helvetica,sans-serif;fill:#111827}</style>',
  ]

  wrappedRows.forEach((cells, rowIndex) => {
    let x = 0
    cells.forEach((lines, columnIndex) => {
      const cellWidth = widths[columnIndex]
      const cellHeight = heights[rowIndex]
      const isHeader = rowIndex === 0
      fragments.push(`<rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="${isHeader ? '#e8f1eb' : '#ffffff'}" stroke="#334155" stroke-width="1"/>`)
      const textY = y + CELL_PADDING_PX + FONT_SIZE_PX
      fragments.push(`<text x="${x + CELL_PADDING_PX}" y="${textY}" font-size="${FONT_SIZE_PX}" font-weight="${isHeader ? '700' : '400'}">`)
      lines.forEach((line, lineIndex) => {
        fragments.push(`<tspan x="${x + CELL_PADDING_PX}" dy="${lineIndex === 0 ? 0 : LINE_HEIGHT_PX}">${escapeXml(line)}</tspan>`)
      })
      fragments.push('</text>')
      x += cellWidth
    })
    y += heights[rowIndex]
  })

  fragments.push('</svg>')
  return { svg: fragments.join(''), width, height }
}

export async function renderMarkdownTableToPng(table: MarkdownTable): Promise<{ png: Buffer; width: number; height: number }> {
  const { svg, width, height } = renderTableSvg(table)
  return { png: await sharp(Buffer.from(svg)).png().toBuffer(), width, height }
}

function collectTexts(exam: ExamGenerationResult): string[] {
  const texts: string[] = []
  for (const question of exam.questions) {
    texts.push(question.statement)
    if (question.supportText) texts.push(question.supportText)
    if (question.alternatives) texts.push(...question.alternatives.map((alternative) => alternative.text))
  }
  return texts
}

/**
 * Renderiza cada tabela distinta uma unica vez em PNG. Google Docs aceita
 * imagens inline de forma consistente; Markdown puro nao e interpretado por
 * sua API e acabaria impresso com pipes e hifens.
 */
export async function buildMarkdownTableImageCache(exam: ExamGenerationResult): Promise<MarkdownTableImageCache> {
  const tables = new Map<string, MarkdownTable>()
  for (const text of collectTexts(exam)) {
    for (const block of splitMarkdownTables(text)) {
      if (block.kind === 'table') tables.set(block.table.raw, block.table)
    }
  }

  const cache: MarkdownTableImageCache = new Map()
  await Promise.all(
    [...tables.values()].map(async (table) => {
      try {
        const { png, width, height } = await renderMarkdownTableToPng(table)
        const { driveFileId } = await uploadToStaging(png, 'image/png', `tabela-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`)
        cache.set(table.raw, { driveFileId, widthPt: width * PT_PER_PX, heightPt: height * PT_PER_PX })
      } catch (error) {
        console.warn('[markdownTableImageCache] falha ao renderizar tabela:', error instanceof Error ? error.message : error)
      }
    }),
  )
  return cache
}
