/** Run with node --env-file=.env --env-file=.env.local --import tsx scripts/classify-missing-bncc.ts --apply */
import postgres from 'postgres'
import { classifyQuestionBncc, hasBnccCodes, BNCC_CLASSIFICATION_VERSION, type BnccContext, type BnccQuestion, type BnccClassification } from '../src/lib/exams/questionBnccClassification'
import { createHash } from 'node:crypto'

const apply = process.argv.includes('--apply')
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='))
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity
const concurrency = Number(process.env.BNCC_BACKFILL_CONCURRENCY ?? 8)
if (!(limit > 0) || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('Limite ou concorrência inválidos.')
const sql = postgres(process.env.DATABASE_URL!, { max: concurrency + 2 })
const stats = { discovered: 0, assessed: 0, mapped: 0, noMatch: 0, unavailable: 0, updated: 0, stale: 0 }
let stopped = false
const memo = new Map<string, Promise<BnccClassification>>()

async function classify(question: BnccQuestion, context: BnccContext) {
  const key = createHash('sha256').update(JSON.stringify({ question, context })).digest('hex')
  let promise = memo.get(key)
  if (!promise) { promise = classifyQuestionBncc(question, context); memo.set(key, promise) }
  const result = await promise
  stats.assessed++
  if (result.bnccAssessment.status === 'unavailable') {
    stats.unavailable++
    console.log(JSON.stringify({ event: 'provider_failure', code: result.bnccAssessment.errorCode }))
    // Stop dispatching new work on outages/auth failures; a rerun resumes missing items.
    stopped = true
  } else if (result.bnccCodes.length) stats.mapped++
  else stats.noMatch++
  if (stats.assessed % 20 === 0) console.log(JSON.stringify({ event: 'progress', ...stats }))
  return result
}

function assessedWithoutMatch(value: unknown): boolean {
  const a = value as BnccClassification['bnccAssessment'] | undefined
  return a?.version === BNCC_CLASSIFICATION_VERSION && a.status === 'no_match' && !process.argv.includes('--retry-no-match')
}

type Work = () => Promise<void>
async function main() {
  const work: Work[] = []
  const imported = await sql`SELECT id, discipline, context, alternatives_introduction, alternatives, correct_alternative, raw_json FROM imported_questions WHERE COALESCE(jsonb_array_length(raw_json->'bnccClassification'->'bnccCodes'), 0) = 0 ORDER BY id`
  for (const row of imported) {
    if (hasBnccCodes({ bnccCodes: row.raw_json?.bnccCodes ?? [] }) || assessedWithoutMatch(row.raw_json?.bnccClassification?.bnccAssessment)) continue
    work.push(async () => {
      const question = { statement: row.alternatives_introduction ?? '', supportText: row.context, alternatives: row.alternatives, correctLetter: row.correct_alternative, bnccCodes: [] }
      const result = await classify(question, { subject: row.discipline ?? 'ENEM', gradeYear: 3, segment: 'ensino-medio' })
      const saved = await sql`UPDATE imported_questions SET raw_json = jsonb_set(COALESCE(raw_json, '{}'::jsonb), '{bnccClassification}', ${sql.json(result)}) WHERE id=${row.id} AND raw_json IS NOT DISTINCT FROM ${sql.json(row.raw_json)}`
      if (saved.count) stats.updated++; else stats.stale++
    })
  }
  const bank = await sql`SELECT * FROM question_bank WHERE COALESCE(cardinality(bncc_codes), 0) = 0 ORDER BY id`
  for (const row of bank) work.push(async () => {
    const result = await classify({ statement: row.statement, alternatives: row.alternatives, correctLetter: row.type === 'objetiva' ? row.correct_answer : null, expectedAnswer: row.type === 'objetiva' ? null : row.correct_answer, bnccCodes: [] }, { subject: row.subject, gradeYear: row.grade_year, segment: row.segment })
    if (!result.bnccCodes.length) return
    const saved = await sql`UPDATE question_bank SET bncc_codes=${sql.array(result.bnccCodes)} WHERE id=${row.id} AND COALESCE(cardinality(bncc_codes),0)=0 AND statement=${row.statement}`
    if (saved.count) stats.updated++; else stats.stale++
  })
  const exams = await sql`SELECT id, subject, segment, grade_year, generation_payload FROM generated_exams WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(generation_payload->'questions') q WHERE COALESCE(jsonb_array_length(q->'bnccCodes'),0)=0) ORDER BY id`
  for (const exam of exams) {
    for (const [index, question] of (exam.generation_payload.questions ?? []).entries()) {
      if (hasBnccCodes({ bnccCodes: question.bnccCodes ?? [] }) || assessedWithoutMatch(question.bnccAssessment)) continue
      work.push(async () => {
        let result: BnccClassification | undefined
        if (question.enemBankRef?.questionId) {
          const [row] = await sql`SELECT raw_json->'bnccClassification' AS classification FROM imported_questions WHERE id=${question.enemBankRef.questionId}`
          if (row?.classification?.bnccCodes?.length) result = row.classification
        }
        result ??= await classify({ statement: question.statement, supportText: question.supportText ?? null, alternatives: question.alternatives ?? null, correctLetter: question.correctLetter ?? null, expectedAnswer: question.expectedAnswer ?? null, commentedResolution: question.commentedResolution ?? null, bnccCodes: [] }, { subject: exam.subject, gradeYear: exam.grade_year, segment: exam.segment })
        const patched = { ...question, ...result }
        const saved = await sql`UPDATE generated_exams SET generation_payload = jsonb_set(generation_payload, ARRAY['questions', ${String(index)}], ${sql.json(patched)}) WHERE id=${exam.id} AND generation_payload->'questions'->${index}::int = ${sql.json(question)}`
        if (saved.count) stats.updated++; else stats.stale++
      })
    }
  }
  stats.discovered = work.length
  console.log(JSON.stringify({ event: 'plan', apply, imported: imported.length, internalBank: bank.length, exams: exams.length, ...stats, concurrency }))
  if (!apply) return
  let cursor = 0
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!stopped && cursor < Math.min(work.length, limit)) {
      const current = cursor++
      try { await work[current]!() }
      catch (error) { stopped = true; stats.unavailable++; console.log(JSON.stringify({ event: 'error', name: error instanceof Error ? error.name : 'Error', code: (error as { code?: string }).code ?? null })) }
    }
  }))
  console.log(JSON.stringify({ event: 'finished', stopped, ...stats, remaining: Math.max(0, work.length - cursor) }))
  if (stopped) process.exitCode = 2
}
main().catch((error) => { console.error(JSON.stringify({ event: 'fatal', name: error.name, code: error.code ?? null })); process.exitCode = 1 }).finally(async () => { await sql.end(); process.exit(process.exitCode ?? 0) })
