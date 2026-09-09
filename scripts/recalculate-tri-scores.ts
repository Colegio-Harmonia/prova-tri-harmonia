/**
 * Recalcula resultados de provas/atividades já revisadas cujo método é TRI.
 * Use depois de aplicar as migrations 0016/0019 e importar os parâmetros
 * oficiais INEP. É seguro repetir: scoreExamCorrections é idempotente.
 *
 * Uso:
 *   npm run recalculate-tri-scores           # lista as candidatas
 *   APPLY=true npm run recalculate-tri-scores # regrava score_result
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'

function loadDatabaseUrlFromLocalEnv() {
  if (process.env.DATABASE_URL) return
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const line = readFileSync(envPath, 'utf8').split(/\r?\n/).find((entry) => entry.trim().startsWith('DATABASE_URL='))
  if (line) process.env.DATABASE_URL = line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')
}

async function main() {
  loadDatabaseUrlFromLocalEnv()
  const APPLY = process.env.APPLY === 'true'
  const { db } = await import('../src/db/client')
  const { generatedExams } = await import('../src/db/schema')
  const { scoreExamCorrections } = await import('../src/lib/scoring/scoreCorrections')

  const exams = await db.query.generatedExams.findMany({
    where: eq(generatedExams.scoringMethod, 'tri'),
    columns: { id: true, subject: true, examKind: true, questionCount: true },
  })

  console.log(`${exams.length} prova(s)/atividade(s) com TRI INEP candidata(s) à recorreção.`)
  for (const exam of exams) {
    if (!APPLY) {
      console.log(`  #${exam.id} — ${exam.subject} (${exam.examKind}, ${exam.questionCount} questões)`)
      continue
    }
    const result = await scoreExamCorrections(exam.id)
    console.log(`  #${exam.id} — ${result.scored} correção(ões) atualizada(s); ${result.calibratedItems ?? 0}/${result.objectiveTotal ?? 0} itens calibrados.`)
  }
  if (!APPLY) console.log('Nada foi alterado. Rode com APPLY=true para recalcular os score_result.')
}

main().catch((error) => {
  console.error('Falha ao recalcular TRI INEP:', error)
  process.exit(1)
})
