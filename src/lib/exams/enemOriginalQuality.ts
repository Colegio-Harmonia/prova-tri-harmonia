import type { ExamQuestion } from '@/lib/gemini/examSchema'

export type EnemOriginal = {
  id: number; year: number; context: string | null; alternatives_introduction: string | null
  correct_alternative: string
  alternatives: Array<{ letter: string; text: string }>
  files: string[] | null
}

const normalize = (text: string | null | undefined) => (text ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()

/** Originals use the official answer key, with content checked against the stored bank. */
export function enemOriginalIssues(question: ExamQuestion, original?: EnemOriginal): string[] {
  const prefix = `Questão ${question.number}: `
  if (!original || original.id !== question.enemBankRef?.questionId || original.year !== question.enemBankRef.year) {
    return [prefix + 'o original do ENEM não foi encontrado no banco.']
  }
  const issues: string[] = []
  const originalText = normalize([original.context, original.alternatives_introduction].filter(Boolean).join('\n'))
  const currentText = normalize([question.supportText, question.statement].filter(Boolean).join('\n'))
  if (!originalText || currentText !== originalText) issues.push(prefix + 'o texto difere do original do ENEM.')
  if (question.type !== 'objetiva' || question.correctLetter !== original.correct_alternative || !question.alternatives?.some((a) => a.letter === original.correct_alternative)) {
    issues.push(prefix + 'o gabarito difere do original do ENEM.')
  }
  if (!original.alternatives?.length || question.alternatives?.length !== original.alternatives.length || original.alternatives.some((a, i) => question.alternatives?.[i]?.letter !== a.letter || normalize(question.alternatives?.[i]?.text) !== normalize(a.text))) {
    issues.push(prefix + 'as alternativas diferem do original do ENEM.')
  }
  if (original.files?.length && !question.image) issues.push(prefix + 'a imagem original do ENEM está ausente.')
  return issues
}

export async function loadEnemOriginals(questions: ExamQuestion[]): Promise<Map<number, EnemOriginal>> {
  const ids = [...new Set(questions.filter((q) => q.source === 'enem_bank').flatMap((q) => q.enemBankRef ? [q.enemBankRef.questionId] : []))]
  if (!ids.length) return new Map()
  const [{ db }, { sql }] = await Promise.all([import('@/db/client'), import('drizzle-orm')])
  const rows = await db.execute<EnemOriginal>(sql`SELECT id, year, context, alternatives_introduction, correct_alternative, alternatives, files FROM imported_questions WHERE source = 'enem' AND id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
  return new Map(Array.from(rows, (row) => [row.id, row]))
}
