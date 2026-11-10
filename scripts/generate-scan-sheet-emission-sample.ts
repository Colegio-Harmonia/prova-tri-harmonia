/** Gera exemplos fictícios; --regression-fixtures cobre as duas geometrias. */
import { mkdir, writeFile } from 'fs/promises'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { generateSheetPdf } from '@/lib/scan-sheets/sheetPdf'
import { CURRENT_SHEET_LAYOUT, planSheetPages } from '@/lib/scan-sheets/sheetLayout'
import { createPageQrPayload, readSheetQrSigningKeys } from '@/lib/scan-sheets/sheetQr'

async function main() {
  const regression = process.argv.includes('--regression-fixtures')
  const publicId = 'QwErTyUiOpAsDfGhJkLzXcVb'
  const [signingKey] = readSheetQrSigningKeys(`amostra-2026=${Buffer.alloc(32, 17).toString('base64url')}`)
  const questions = [
    ...Array.from({ length: regression ? 15 : 8 }, (_, index) => ({
      number: regression ? index + 1 : [2, 3, 5, 6, 8, 9, 11, 12][index],
      type: 'objetiva',
      alternatives: ['A', 'B', 'C', 'D', 'E'].slice(0, (regression ? index % 2 : [1, 5].includes(index)) ? 4 : 5).map((letter) => ({ letter })),
    })),
    ...Array.from({ length: regression ? 3 : 4 }, (_, index) => ({ number: regression ? 16 + index : [1, 4, 7, 10][index], type: 'descritiva' })),
  ] as ExamQuestion[]

  await mkdir('output/pdf', { recursive: true })
  for (const layoutVersion of regression ? ['PTR1', 'PTR2', 'PTR3'] : [CURRENT_SHEET_LAYOUT]) {
    const tokens = planSheetPages(questions).map((_, index) => createPageQrPayload({ publicId, pageNumber: index + 1, layoutVersion }, signingKey))
    const pdf = await generateSheetPdf({
      examId: 123,
      studentName: 'Estudante de teste',
      subject: regression ? 'Matemática' : 'Ciências',
      gradeYear: regression ? 2 : 7,
      academicYear: 2026,
      bimester: regression ? 2 : 4,
      publicId,
      layoutVersion,
      qrTokens: tokens,
      questions,
    })

    const output = regression ? `output/pdf/scan-regression-${layoutVersion}.pdf` : 'output/pdf/cartao-resposta-emissao-exemplo.pdf'
    await writeFile(output, pdf)
    console.log(output)
  }
}

void main()
