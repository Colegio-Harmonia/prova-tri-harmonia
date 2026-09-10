/**
 * Recuperação única após a migração do fluxo de aprovação (2026-09-10).
 * Aprova somente provas formais que ficaram em `em_revisao` e ainda não
 * possuem documentos, gerando os três artefatos antes de gravar o status.
 * Não toca em prova impressa, aplicada, corrigida ou já aprovada.
 */
import { eq, and, isNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams } from '@/db/schema'
import { generateExamDocs } from '@/lib/docs/generateExamDocs'
import type { ExamGenerationResult } from '@/lib/gemini/examSchema'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const targets = await db.query.generatedExams.findMany({
    where: and(
      eq(generatedExams.examKind, 'prova'),
      eq(generatedExams.status, 'em_revisao'),
      isNull(generatedExams.provaDocId),
    ),
    orderBy: (table, { asc }) => [asc(table.id)],
  })

  console.log(`[recover-approval] ${targets.length} prova(s) serão aprovadas.`)
  const failures: Array<{ id: number; error: string }> = []
  for (const exam of targets) {
    try {
      let docs: Awaited<ReturnType<typeof generateExamDocs>> | null = null
      let lastError: unknown
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          docs = await generateExamDocs(exam.generationPayload as ExamGenerationResult, {
            segment: exam.segment,
            gradeYear: exam.gradeYear,
            subject: exam.subject,
            bimester: exam.bimester,
            examKind: exam.examKind,
          })
          break
        } catch (error) {
          lastError = error
          const isRateLimit = error instanceof Error && /rate limit|quota|429/i.test(error.message)
          if (!isRateLimit || attempt === 5) throw error
          const delaySeconds = attempt * 15
          console.warn(`[recover-approval] limite do Drive na prova #${exam.id}; nova tentativa em ${delaySeconds}s.`)
          await sleep(delaySeconds * 1000)
        }
      }
      if (!docs) throw lastError
      await db.update(generatedExams).set({
        status: 'aprovado',
        reviewedAt: new Date(),
        finalizedAt: new Date(),
        driveFolderId: docs.driveFolderId,
        provaDocId: docs.prova.docId,
        provaDocUrl: docs.prova.url,
        gabaritoDocId: docs.gabarito.docId,
        gabaritoDocUrl: docs.gabarito.url,
        mapaDocId: docs.mapa.docId,
        mapaDocUrl: docs.mapa.url,
      }).where(eq(generatedExams.id, exam.id))
      console.log(`[recover-approval] prova #${exam.id} aprovada.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ id: exam.id, error: message })
      console.error(`[recover-approval] prova #${exam.id} falhou: ${message}`)
    }
    // Evita rajadas de três cópias/edições de Docs por prova.
    await sleep(4_000)
  }
  if (failures.length) {
    console.error(JSON.stringify({ failures }))
    process.exitCode = 1
  }
}

void main()
