import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { planSheetPages } from './sheetLayout'
import { generateSheetPdf } from './sheetPdf'

const questions = [
  { number: 1, type: 'objetiva', alternatives: [{ letter: 'A' }, { letter: 'B' }, { letter: 'C' }, { letter: 'D' }, { letter: 'E' }] },
  { number: 2, type: 'descritiva' },
  { number: 3, type: 'descritiva' },
] as ExamQuestion[]

describe('PDF individual PTR1', () => {
  it('gera uma página objetiva e uma discursiva com QR independente', async () => {
    const pdf = await generateSheetPdf({
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
