import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'

// Junta as provas (ou gabaritos) individuais de uma sala num PDF só, na ordem
// recebida (alfabética), carimbando o nome do aluno no topo de cada página.
// O nome existe só neste PDF gerado na hora do download: os Google Docs da
// prova não guardam dado do aluno (mesma regra da prova adaptada, LGPD).
// Em frente e verso, cada aluno começa numa folha nova (página em branco
// quando a prova tem número ímpar de páginas), para grampear sem misturar.
// O cartão-resposta (appendix) vem logo depois da prova, também em folha
// nova, e NÃO recebe carimbo: ele já traz o nome e qualquer marca por cima
// atrapalharia a leitura do QR e das bolhas pelo scanner.

export type RoomPdfEntry = { studentName: string; pdf: Uint8Array; appendix?: Uint8Array }

function encodable(font: PDFFont, text: string) {
  try {
    font.encodeText(text)
    return text
  } catch {
    // Caractere fora do WinAnsi (Helvetica padrão): cai para a forma sem acento.
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '?')
  }
}

export async function buildRoomPdf(entries: RoomPdfEntry[], options: { header: string; duplex?: boolean }): Promise<Uint8Array> {
  const output = await PDFDocument.create()
  const font = await output.embedFont(StandardFonts.HelveticaBold)
  const duplex = options.duplex ?? true

  for (const entry of entries) {
    const source = await PDFDocument.load(entry.pdf)
    const pages = await output.copyPages(source, source.getPageIndices())
    const label = encodable(font, `${entry.studentName} · ${options.header}`)
    pages.forEach((page, index) => {
      output.addPage(page)
      const { width, height } = page.getSize()
      const text = `${label} · pág. ${index + 1}/${pages.length}`
      const size = 8
      const textWidth = font.widthOfTextAtSize(text, size)
      page.drawRectangle({ x: width - textWidth - 30, y: height - 22, width: textWidth + 12, height: 14, color: rgb(1, 1, 1) })
      page.drawText(text, { x: width - textWidth - 24, y: height - 18, size, font, color: rgb(0.15, 0.15, 0.15) })
    })
    const padToNewSheet = () => {
      if (!duplex || output.getPageCount() % 2 === 0) return
      const last = output.getPage(output.getPageCount() - 1).getSize()
      output.addPage([last.width, last.height])
    }
    padToNewSheet()
    if (entry.appendix) {
      const appendix = await PDFDocument.load(entry.appendix)
      for (const page of await output.copyPages(appendix, appendix.getPageIndices())) output.addPage(page)
      padToNewSheet()
    }
  }
  return output.save()
}
