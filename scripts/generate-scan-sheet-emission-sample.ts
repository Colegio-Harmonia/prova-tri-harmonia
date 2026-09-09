/** Gera um artefato fictício para inspeção visual do emissor PTR1. */
import { writeFile } from 'fs/promises'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { generateSheetPdf } from '@/lib/scan-sheets/sheetPdf'
import { createPageQrPayload, readSheetQrSigningKeys } from '@/lib/scan-sheets/sheetQr'

async function main() {
  const publicId = 'QwErTyUiOpAsDfGhJkLzXcVb'
  const [signingKey] = readSheetQrSigningKeys(`amostra-2026=${Buffer.alloc(32, 17).toString('base64url')}`)
  const questions = [
    ...Array.from({ length: 10 }, (_, index) => ({
      number: index + 1,
      type: 'objetiva',
      alternatives: ['A', 'B', 'C', 'D', 'E'].map((letter) => ({ letter })),
    })),
    { number: 11, type: 'descritiva' },
    { number: 12, type: 'descritiva' },
    { number: 13, type: 'descritiva' },
  ] as ExamQuestion[]

  const tokens = [1, 2].map((pageNumber) => createPageQrPayload({ publicId, pageNumber, layoutVersion: 'PTR1' }, signingKey))
  const pdf = await generateSheetPdf({
    studentName: 'Estudante de teste',
    subject: 'Matemática',
    gradeYear: 2,
    academicYear: 2026,
    bimester: 2,
    publicId,
    layoutVersion: 'PTR1',
    qrTokens: tokens,
    questions,
  })

  const output = 'output/pdf/cartao-resposta-emissao-exemplo.pdf'
  await writeFile(output, pdf)
  console.log(output)
}

void main()
