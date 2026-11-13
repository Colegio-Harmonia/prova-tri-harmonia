import { PDFDocument, PDFPage } from 'pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { planSheetPages } from './sheetLayout'
import { generateSheetPdf } from './sheetPdf'

const questions = [
  { number: 1, type: 'objetiva', alternatives: [{ letter: 'A' }, { letter: 'B' }, { letter: 'C' }, { letter: 'D' }, { letter: 'E' }] },
  { number: 2, type: 'descritiva' },
  { number: 3, type: 'descritiva' },
] as ExamQuestion[]

// Gerar o PDF passa de 5 s no runner do CI com cobertura ligada (falhou 2 de 3
// execuções em 13/11/2026 por tempo, não por conteúdo).
describe('PDF individual com geometria versionada', { timeout: 30_000 }, () => {
  afterEach(() => vi.restoreAllMocks())

  it.each(['PTR1', 'PTR2', 'PTR3'])('imprime o ID em todas as páginas e separa a orientação das bolhas em %s', async (layoutVersion) => {
    const text = vi.spyOn(PDFPage.prototype, 'drawText')
    const circles = vi.spyOn(PDFPage.prototype, 'drawCircle')
    const objective = Array.from({ length: 15 }, (_, index) => ({
      ...questions[0], number: index + 1,
      alternatives: questions[0].alternatives!.slice(0, index % 2 ? 4 : 5),
    }))
    const pdf = await generateSheetPdf({
      examId: 456,
      studentName: 'Estudante de teste', subject: 'Ciências', gradeYear: 7,
      academicYear: 2026, bimester: 4, publicId: 'QwErTyUiOpAsDfGhJkLzXcVb',
      layoutVersion, qrTokens: ['qr-1', 'qr-2'], questions: [...objective, questions[1]],
    })
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2)
    expect(text.mock.calls.filter(([value]) => value === 'ID DA PROVA: #456')).toHaveLength(2)
    const instruction = text.mock.calls.find(([value]) => value.startsWith('Preencha completamente'))![1]!
    const mm = 72 / 25.4
    const firstRowTop = layoutVersion === 'PTR1' ? 132.1 : layoutVersion === 'PTR2' ? 137 : 98
    // O limite inferior do texto deve ficar acima da primeira borda.
    expect(instruction.y!).toBeGreaterThan((297 - firstRowTop) * mm)
    expect(circles.mock.calls).toHaveLength(68)
    const firstCenter = layoutVersion === 'PTR1' ? 137.6 : layoutVersion === 'PTR2' ? 141 : 102
    const gap = layoutVersion === 'PTR1' ? 13 : 9
    let bubble = 0
    objective.forEach((question, index) => {
      question.alternatives!.forEach((_, option) => {
        const circle = circles.mock.calls[bubble++][0]!
        expect(circle.x).toBeCloseTo(((index < 8 ? 46.3 : 145) + option * 8.5) * mm)
        expect(circle.y).toBeCloseTo((297 - firstCenter - (index % 8) * gap) * mm)
        expect(circle.size).toBeCloseTo(2.5 * mm)
      })
    })
    if (layoutVersion === 'PTR3') {
      expect(text.mock.calls.filter(([value]) => value === 'Estudante de teste')).toHaveLength(2)
      expect(text.mock.calls.some(([value]) => value.startsWith('Aluno:'))).toBe(false)
      const student = text.mock.calls.find(([value]) => value === 'Estudante de teste')![1]!
      expect(student.y!).toBeGreaterThan((297 - 70) * mm)
    }
  })

  it('gera uma página objetiva e uma discursiva com QR independente', async () => {
    const pdf = await generateSheetPdf({
      examId: 123,
      studentName: 'Estudante de teste',
      subject: 'Matemática',
      gradeYear: 2,
      academicYear: 2026,
      bimester: 2,
      publicId: 'QwErTyUiOpAsDfGhJkLzXcVb',
      layoutVersion: 'PTR1',
      qrTokens: ['PTR1.QwErTyUiOpAsDfGhJkLzXcVb.1.PTR1.jul-2026.assinatura', 'PTR1.QwErTyUiOpAsDfGhJkLzXcVb.2.PTR1.jul-2026.assinatura'],
      questions,
    })

    const reloaded = await PDFDocument.load(pdf)
    expect(reloaded.getPageCount()).toBe(2)
    expect(reloaded.getTitle()).toBe('Folha de respostas - Colégio Harmonia')
  })

  it('preserva o limite de quinze objetivas no layout', () => {
    const tooMany = Array.from({ length: 16 }, (_, index) => ({
      number: index + 1,
      type: 'objetiva',
      alternatives: [{ letter: 'A' }, { letter: 'B' }, { letter: 'C' }, { letter: 'D' }],
    })) as ExamQuestion[]

    expect(() => planSheetPages(tooMany)).toThrow('no máximo 15')
  })
})
