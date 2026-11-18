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

  it('intercala o cartão-resposta depois da prova de cada aluno, em folha nova', async () => {
    const merged = await buildRoomPdf([
      { studentName: 'Ana', pdf: await pdfWithPages(3), appendix: await pdfWithPages(1) },
      { studentName: 'Bruno', pdf: await pdfWithPages(2), appendix: await pdfWithPages(2) },
    ], { header: 'Turma' })
    // Ana: 3 + branco + cartão 1 + branco = 6; Bruno: 2 + cartão 2 = 4
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(10)
  })

  it('sem frente e verso não insere página em branco e aceita nome fora do WinAnsi', async () => {
    const merged = await buildRoomPdf([{ studentName: 'Łukasz Nguyễn', pdf: await pdfWithPages(3) }], { header: 'Turma', duplex: false })
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(3)
  })
})
