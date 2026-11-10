/** Idempotent reference-data repair; leaves questions and classifications intact. */
import postgres from 'postgres'
import { getEnemSkillDescription } from '../src/config/enemMatrix'

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurado')
  const sql = postgres(process.env.DATABASE_URL)
  try {
    const description = getEnemSkillDescription('linguagens', 7)!
    const rows = await sql`
      UPDATE enem_skills s SET description=${description}
      FROM enem_competencies c JOIN enem_areas a ON a.id=c.area_id
      WHERE s.competency_id=c.id AND a.code='linguagens' AND s.code='H7'
        AND s.description IS DISTINCT FROM ${description}
      RETURNING s.id,s.code
    `
    console.log(JSON.stringify({ repairedReferenceRows: rows.length, area: 'linguagens', skill: 'H7' }))
  } finally { await sql.end() }
}
main().catch(() => { console.error('Falha ao corrigir a referência H7; confira a conexão e o catálogo.'); process.exitCode = 1 })
