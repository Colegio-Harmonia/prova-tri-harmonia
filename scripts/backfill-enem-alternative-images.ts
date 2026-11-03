/**
 * Preenche a figura original das alternativas-imagem do banco ENEM em provas
 * já geradas antes de `enemBankMerge` passar a importá-las (caso real: exam
 * #586, questão 7 = ENEM 2013/151, alternativas A-E mostravam só o
 * placeholder). Não toca texto, gabarito nem revisão da questão.
 *   node --env-file=.env node_modules/.bin/tsx scripts/backfill-enem-alternative-images.ts 586
 *   APPLY=true node --env-file=.env node_modules/.bin/tsx scripts/backfill-enem-alternative-images.ts 586
 */
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'
import { importImageFromUrl } from '@/lib/images/questionImageService'

type BankAlternative = { letter: string; text: string | null; file?: string | null }

async function main() {
  const examId = Number(process.argv[2])
  if (!Number.isSafeInteger(examId)) throw new Error('Uso: backfill-enem-alternative-images.ts <examId>')
  const apply = process.env.APPLY === 'true'

  const [exam] = await db.select().from(generatedExams).where(eq(generatedExams.id, examId))
  if (!exam) throw new Error(`Prova ${examId} não encontrada.`)
  const payload = exam.generationPayload as ExamGenerationResult

  let filled = 0
  const questions = await Promise.all(payload.questions.map(async (question) => {
    const bankId = question.enemBankRef?.questionId
    if (question.source !== 'enem_bank' || !bankId || !question.alternatives?.some((a) => !a.text && !a.image)) return question

    const rows = await db.execute<{ alternatives: BankAlternative[] }>(sql`SELECT alternatives FROM imported_questions WHERE id = ${bankId}`)
    const bankAlternatives = (rows as unknown as Array<{ alternatives: BankAlternative[] }>)[0]?.alternatives ?? []
    const alternatives = await Promise.all(question.alternatives.map(async (alternative) => {
      const file = bankAlternatives.find((candidate) => candidate.letter === alternative.letter)?.file
      if (alternative.text || alternative.image || !file) return alternative
      if (!apply) {
        console.log(`[dry-run] questão ${question.number} alternativa ${alternative.letter}: ${file}`)
        filled++
        return alternative
      }
      const resolved = await importImageFromUrl(file, 'enem')
      filled++
      return { ...alternative, image: { driveFileId: resolved.driveFileId, previewUrl: resolved.previewUrl, sourceUrl: file } }
    }))
    return { ...question, alternatives }
  }))

  if (apply && filled) {
    await db.update(generatedExams).set({ generationPayload: { ...payload, questions } }).where(eq(generatedExams.id, examId))
  }
  console.log(`${apply ? 'Aplicado' : 'Dry-run'}: ${filled} alternativa(s)-imagem ${apply ? 'preenchida(s)' : 'a preencher'} na prova ${examId}.`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
