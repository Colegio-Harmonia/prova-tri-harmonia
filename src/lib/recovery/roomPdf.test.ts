import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildRoomPdf } from './roomPdf'

async function pdfWithPages(count: number) {
  const doc = await PDFDocument.create()
  for (let index = 0; index < count; index++) doc.addPage([595, 842])
  return doc.save()
}

describe('buildRoomPdf', () => {
  it('junta as provas na ordem recebida e começa cada aluno numa folha nova em frente e verso', async () => {
    const merged = await buildRoomPdf([
      { studentName: 'Ana Júlia', pdf: await pdfWithPages(3) },
      { studentName: 'Bruno', pdf: await pdfWithPages(2) },
    ], { header: '7º ano A · Matemática' })
    const doc = await PDFDocument.load(merged)
    // 3 + 1 em branco + 2
    expect(doc.getPageCount()).toBe(6)
  })

  it('sem frente e verso não insere página em branco e aceita nome fora do WinAnsi', async () => {
    const merged = await buildRoomPdf([{ studentName: 'Łukasz Nguyễn', pdf: await pdfWithPages(3) }], { header: 'Turma', duplex: false })
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(3)
  })
})
