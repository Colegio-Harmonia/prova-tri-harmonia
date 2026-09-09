import { readFile } from 'fs/promises'
import { join } from 'path'
import QRCode from 'qrcode'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { planSheetPages } from '@/lib/scan-sheets/sheetLayout'

const MM = 72 / 25.4
const PAGE_WIDTH = 210 * MM
const PAGE_HEIGHT = 297 * MM
const MARGIN = 12 * MM
const MARKER_SIZE = 7 * MM
const QR_SIZE = 27 * MM
// Coordenadas aferidas no piloto impresso PTR1. Mantê-las junto ao gerador
// impede que uma alteração visual quebre a leitura óptica silenciosamente.
const OBJECTIVE_LEFT_X = 9.3 * MM
const OBJECTIVE_RIGHT_X = 108 * MM
const OBJECTIVE_FIRST_ROW_TOP = 132.1 * MM
const OBJECTIVE_ROW_GAP = 13 * MM

const colors = {
  green: rgb(0, 0.525, 0.286),
  paleGreen: rgb(0.906, 0.957, 0.925),
  gray: rgb(0.957, 0.965, 0.961),
  text: rgb(0.125, 0.145, 0.133),
  muted: rgb(0.35, 0.39, 0.36),
  border: rgb(0.79, 0.83, 0.80),
}

export type SheetPdfInput = {
  studentName: string
  subject: string
  gradeYear: number
  academicYear: number
  bimester: number | null
  publicId: string
  layoutVersion: string
  qrTokens: string[]
  questions: ExamQuestion[]
}

function yFromTop(top: number, height = 0) {
  return PAGE_HEIGHT - top - height
}

function drawTopText(page: PDFPage, text: string, x: number, top: number, size: number, font: PDFFont, color = colors.text) {
  page.drawText(text, { x, y: yFromTop(top, size), size, font, color })
}

function drawCenteredTopText(page: PDFPage, text: string, centerX: number, top: number, size: number, font: PDFFont, color = colors.text) {
  drawTopText(page, text, centerX - font.widthOfTextAtSize(text, size) / 2, top, size, font, color)
}

function drawFiducials(page: PDFPage) {
  const positions = [
    [MARGIN, MARGIN],
    [PAGE_WIDTH - MARGIN - MARKER_SIZE, MARGIN],
    [MARGIN, PAGE_HEIGHT - MARGIN - MARKER_SIZE],
    [PAGE_WIDTH - MARGIN - MARKER_SIZE, PAGE_HEIGHT - MARGIN - MARKER_SIZE],
  ]
  for (const [x, y] of positions) page.drawRectangle({ x, y, width: MARKER_SIZE, height: MARKER_SIZE, color: rgb(0, 0, 0) })
}

async function qrPng(token: string) {
  const dataUrl = await QRCode.toDataURL(token, { errorCorrectionLevel: 'M', margin: 1, width: 360 })
  return Uint8Array.from(Buffer.from(dataUrl.split(',')[1], 'base64'))
}

async function drawHeader(
  pdf: PDFDocument,
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  logo: Uint8Array,
  params: { title: string; pageNumber: number; pageCount: number; qrToken: string; studentName: string; layoutVersion: string },
) {
  drawFiducials(page)
  page.drawRectangle({ x: MARGIN, y: PAGE_HEIGHT - 43 * MM, width: 116 * MM, height: 18 * MM, color: colors.green })
  page.drawRectangle({ x: MARGIN + 5 * MM, y: PAGE_HEIGHT - 40.5 * MM, width: 13 * MM, height: 13 * MM, color: rgb(1, 1, 1) })
  const logoImage = await pdf.embedPng(logo)
  page.drawImage(logoImage, { x: MARGIN + 6.5 * MM, y: PAGE_HEIGHT - 39 * MM, width: 10 * MM, height: 10 * MM })
  drawTopText(page, 'COLÉGIO HARMONIA', MARGIN + 22 * MM, 29 * MM, 14, fonts.bold, rgb(1, 1, 1))
  drawTopText(page, params.title, MARGIN + 22 * MM, 35.5 * MM, 8.5, fonts.regular, rgb(1, 1, 1))

  const image = await pdf.embedPng(await qrPng(params.qrToken))
  const qrX = PAGE_WIDTH - MARGIN - QR_SIZE
  page.drawImage(image, { x: qrX, y: PAGE_HEIGHT - 65 * MM, width: QR_SIZE, height: QR_SIZE })
  const qrCenter = qrX + QR_SIZE / 2
  drawCenteredTopText(page, 'IDENTIFICAÇÃO DA FOLHA', qrCenter, 67 * MM, 7.3, fonts.bold)
  drawCenteredTopText(page, `Página ${params.pageNumber}/${params.pageCount} - Layout ${params.layoutVersion}`, qrCenter, 71.2 * MM, 6.7, fonts.regular, colors.muted)
  drawCenteredTopText(page, 'Não cubra o QR no scan', qrCenter, 75.3 * MM, 6.7, fonts.regular, colors.muted)
  drawTopText(page, `Aluno: ${params.studentName}`, MARGIN, 79.5 * MM, 7.5, fonts.regular, colors.muted)
}

function drawInfoBox(page: PDFPage, fonts: { regular: PDFFont; bold: PDFFont }, input: SheetPdfInput) {
  const top = 92 * MM
  const height = 28 * MM
  const width = PAGE_WIDTH - 2 * MARGIN
  page.drawRectangle({ x: MARGIN, y: yFromTop(top, height), width, height, color: colors.gray, borderColor: colors.border, borderWidth: 0.6 })
  const fields = [
    ['ALUNO', input.studentName],
    ['TURMA', `${input.gradeYear}ª série`],
    ['PROVA', input.subject],
    ['ANO LETIVO', `${input.academicYear}${input.bimester ? ` - ${input.bimester}º bimestre` : ''}`],
  ]
  fields.forEach(([label, value], index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    const x = MARGIN + column * (width / 2) + 5 * MM
    const fieldTop = top + 6 * MM + row * 12 * MM
    drawTopText(page, label, x, fieldTop, 7.3, fonts.bold, colors.muted)
    drawTopText(page, value, x, fieldTop + 4.5 * MM, 9.5, fonts.regular)
  })
}

function drawBubble(page: PDFPage, fonts: { regular: PDFFont; bold: PDFFont }, x: number, top: number, letter: string) {
  const radius = 2.5 * MM
  page.drawCircle({ x, y: yFromTop(top), size: radius, borderColor: colors.muted, borderWidth: 0.8 })
  drawCenteredTopText(page, letter, x, top - 2.7, 8, fonts.bold)
}

function drawObjectiveRow(page: PDFPage, fonts: { regular: PDFFont; bold: PDFFont }, x: number, top: number, question: ExamQuestion) {
  const rowWidth = 82 * MM
  const rowHeight = 11 * MM
  page.drawRectangle({ x, y: yFromTop(top, rowHeight), width: rowWidth, height: rowHeight, color: rgb(1, 1, 1), borderColor: colors.border, borderWidth: 0.7 })
  drawCenteredTopText(page, String(question.number), x + 8 * MM, top + 3.7 * MM, 10, fonts.bold)
  drawTopText(page, 'MARQUE UMA', x + 14 * MM, top + 3.7 * MM, 7.5, fonts.regular, colors.muted)
  const letters = question.alternatives!.map((alternative) => alternative.letter)
  letters.forEach((letter, index) => drawBubble(page, fonts, x + 37 * MM + index * 8.5 * MM, top + rowHeight / 2, letter))
}

function drawObjectivePage(page: PDFPage, fonts: { regular: PDFFont; bold: PDFFont }, input: SheetPdfInput, questions: ExamQuestion[]) {
  drawInfoBox(page, fonts, input)
  drawTopText(page, 'Respostas objetivas', MARGIN, 125 * MM, 10.5, fonts.bold)
  drawTopText(page, 'Preencha completamente apenas uma bolha por questão, com caneta escura.', MARGIN, 130 * MM, 8, fonts.regular, colors.muted)
  questions.slice(0, 8).forEach((question, index) => drawObjectiveRow(page, fonts, OBJECTIVE_LEFT_X, OBJECTIVE_FIRST_ROW_TOP + index * OBJECTIVE_ROW_GAP, question))
  questions.slice(8).forEach((question, index) => drawObjectiveRow(page, fonts, OBJECTIVE_RIGHT_X, OBJECTIVE_FIRST_ROW_TOP + index * OBJECTIVE_ROW_GAP, question))
  page.drawRectangle({ x: MARGIN, y: 43 * MM, width: PAGE_WIDTH - 2 * MARGIN, height: 14 * MM, color: colors.paleGreen, borderColor: rgb(0.65, 0.84, 0.72), borderWidth: 0.6 })
  page.drawText('CONFERÊNCIA', { x: MARGIN + 4 * MM, y: 51 * MM, size: 8, font: fonts.bold, color: colors.text })
  page.drawText('Não dobre, não cubra o QR e não escreva sobre os marcadores pretos dos cantos.', { x: MARGIN + 4 * MM, y: 47 * MM, size: 7.3, font: fonts.regular, color: colors.text })
}

function drawDiscursivePage(page: PDFPage, fonts: { regular: PDFFont; bold: PDFFont }, questions: ExamQuestion[]) {
  drawTopText(page, 'Escreva somente dentro das áreas delimitadas. Mantenha o QR e os marcadores visíveis no scan.', MARGIN, 88 * MM, 7.8, fonts.regular, colors.muted)
  const gap = 7 * MM
  const top = 100 * MM
  const availableHeight = 147 * MM
  const height = (availableHeight - gap * (questions.length - 1)) / questions.length
  for (const [index, question] of questions.entries()) {
    const boxTop = top + index * (height + gap)
    page.drawRectangle({ x: MARGIN, y: yFromTop(boxTop, height), width: PAGE_WIDTH - 2 * MARGIN, height, color: rgb(1, 1, 1), borderColor: rgb(0.73, 0.76, 0.74), borderWidth: 0.7 })
    drawTopText(page, `QUESTÃO ${question.number}`, MARGIN + 4 * MM, boxTop + 5 * MM, 9.5, fonts.bold, colors.green)
    drawTopText(page, 'Escreva somente dentro desta área.', MARGIN + 31 * MM, boxTop + 5.2 * MM, 7.5, fonts.regular, colors.muted)
    for (let lineTop = boxTop + 15 * MM; lineTop < boxTop + height - 7 * MM; lineTop += 6 * MM) {
      page.drawLine({ start: { x: MARGIN + 4 * MM, y: yFromTop(lineTop) }, end: { x: PAGE_WIDTH - MARGIN - 4 * MM, y: yFromTop(lineTop) }, thickness: 0.5, color: rgb(0.87, 0.90, 0.88) })
    }
  }
}

export async function generateSheetPdf(input: SheetPdfInput): Promise<Uint8Array> {
  if (input.layoutVersion !== 'PTR1') throw new Error(`Versão de layout não suportada: ${input.layoutVersion}`)
  const pages = planSheetPages(input.questions)
  if (input.qrTokens.length !== pages.length) throw new Error('A quantidade de QR não corresponde às páginas da folha.')

  const [logo, pdf] = await Promise.all([
    readFile(join(process.cwd(), 'public', 'brand', 'harmonia-icon.png')),
    PDFDocument.create(),
  ])
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  pdf.setTitle('Folha de respostas - Colégio Harmonia')
  pdf.setAuthor('Colégio Harmonia')
  pdf.setSubject('Folha individual para leitura óptica')
  pdf.setCreationDate(new Date())

  for (const [index, plannedPage] of pages.entries()) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    await drawHeader(pdf, page, { regular, bold }, logo, {
      title: plannedPage.kind === 'objective' ? 'CARTÃO-RESPOSTA' : 'FOLHA DISCURSIVA',
      pageNumber: index + 1,
      pageCount: pages.length,
      qrToken: input.qrTokens[index],
      studentName: input.studentName,
      layoutVersion: input.layoutVersion,
    })
    if (plannedPage.kind === 'objective') drawObjectivePage(page, { regular, bold }, input, plannedPage.questions)
    else drawDiscursivePage(page, { regular, bold }, plannedPage.questions)
    drawTopText(page, 'Folha individual - use A4 em escala 100% - não recorte os marcadores.', MARGIN, 276 * MM, 7, regular, colors.muted)
  }

  return pdf.save()
}
