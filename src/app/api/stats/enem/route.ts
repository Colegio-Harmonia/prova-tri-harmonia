import { NextResponse } from 'next/server'
import { sql, eq, count } from 'drizzle-orm'
import { db } from '@/db/client'
import { auth } from '@/auth/auth'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  // As 10 queries abaixo são todas independentes (nenhuma usa o resultado
  // de outra) — antes rodavam uma atrás da outra (10 idas-e-voltas
  // sequenciais ao banco), agora disparam juntas via Promise.all. Achado
  // aplicando a skill vercel-react-best-practices (regra async-parallel,
  // impacto CRITICAL: "Promise.all() for Independent Operations").
  const bloomLevels = ['lembrar', 'compreender', 'aplicar', 'analisar', 'avaliar', 'criar']

  const [totalRows, byYear, byArea, bloomRaw, matrixStats, skillStats, competencyStats, skillInCompetencyStats, sourceStats, axisStats, axisNamesRaw] =
    await Promise.all([
      // ── Totais ──────────────────────────────────────────────────
      db.execute<{ count: number }>(sql`SELECT COUNT(*)::int AS count FROM imported_questions`),

      // ── Por ano ─────────────────────────────────────────────────
      db.execute<{ year: number; count: number }>(
        sql`SELECT year, COUNT(*)::int AS count FROM imported_questions GROUP BY year ORDER BY year DESC`
      ),

      // ── Por área (disciplina) ───────────────────────────────────
      db.execute<{ area: string | null; count: number }>(
        sql`
          SELECT
            CASE
              WHEN discipline = 'linguagens' THEN 'Linguagens'
              WHEN discipline = 'matematica' THEN 'Matemática'
              WHEN discipline = 'ciencias-natureza' THEN 'Ciências da Natureza'
              WHEN discipline = 'ciencias-humanas' THEN 'Ciências Humanas'
              ELSE discipline
            END AS area,
            COUNT(*)::int AS count
          FROM imported_questions
          GROUP BY area
          ORDER BY count DESC
        `
      ),

      // ── Bloom ───────────────────────────────────────────────────
      db.execute<{ level: string; count: number }>(
        sql`
          SELECT COALESCE(c.bloom_level, 'pending') AS level, COUNT(*)::int AS count
          FROM imported_question_classifications c
          WHERE c.source = 'enem'
          GROUP BY level
          ORDER BY level
        `
      ),

      // ── ENEM Matrix Stats ───────────────────────────────────────
      // "area" aqui usa o MESMO rótulo (capitalizado, com acento) que a
      // query `byArea` acima — antes retornava o slug cru de
      // enem_areas.code ("ciencias-natureza"), e o frontend tentava casar
      // contra o rótulo exibido ("Ciências da Natureza") removendo
      // espaços em vez de virar hífen, então a área nunca batia e a
      // tabela cruzada ficava com "-" em Ciências da Natureza/Humanas
      // mesmo havendo dados reais. Retornando o rótulo já pronto elimina
      // a necessidade de casar slugs no cliente.
      db.execute<{ area: string; count: number; level: string | null }>(
        sql`
          SELECT
            CASE
              WHEN a.code = 'linguagens' THEN 'Linguagens'
              WHEN a.code = 'matematica' THEN 'Matemática'
              WHEN a.code = 'ciencias-natureza' THEN 'Ciências da Natureza'
              WHEN a.code = 'ciencias-humanas' THEN 'Ciências Humanas'
              ELSE COALESCE(a.code, 'sem_area')
            END AS area,
            COUNT(*)::int AS count,
            c.bloom_level AS level
          FROM imported_question_classifications c
          LEFT JOIN enem_areas a ON a.id = c.enem_area_id
          WHERE c.source = 'enem'
          GROUP BY area, c.bloom_level
          ORDER BY area, level
        `
      ),

      // ── Competência e Habilidade stats ──────────────────────────
      db.execute<{ skill_code: string | null; skill_description: string | null; count: number }>(
        sql`
          SELECT s.code AS skill_code, s.description AS skill_description, COUNT(*)::int AS count
          FROM imported_question_classifications c
          LEFT JOIN enem_skills s ON s.id = c.enem_skill_id
          WHERE c.source = 'enem'
          GROUP BY s.code, s.description
          ORDER BY count DESC
          LIMIT 30
        `
      ),

      // ── Distribuição por Competência (agrupa as habilidades H1-H30 num
      // nível mais alto, C1-C9 por área) ──────────────────────────
      db.execute<{ area: string; number: number; description: string; count: number }>(
        sql`
          SELECT a.code AS area, ec.number AS number, ec.description AS description, COUNT(*)::int AS count
          FROM imported_question_classifications c
          JOIN enem_competencies ec ON ec.id = c.enem_competency_id
          JOIN enem_areas a ON a.id = ec.area_id
          WHERE c.source = 'enem'
          GROUP BY a.code, a."order", ec.number, ec.description
          ORDER BY a."order", ec.number
        `
      ),

      // ── Habilidades dentro de cada Competência (drill-down da aba "Por
      // Competência" — quantas questões de cada H específica compõem o
      // total de cada C, pra ver se está bem distribuído ou concentrado
      // numa só) ───────────────────────────────────────────────────
      db.execute<{
        area: string
        competency_number: number
        skill_code: string | null
        skill_description: string | null
        count: number
      }>(
        sql`
          SELECT a.code AS area, ec.number AS competency_number, s.code AS skill_code, s.description AS skill_description, COUNT(*)::int AS count
          FROM imported_question_classifications c
          JOIN enem_skills s ON s.id = c.enem_skill_id
          JOIN enem_competencies ec ON ec.id = s.competency_id
          JOIN enem_areas a ON a.id = ec.area_id
          WHERE c.source = 'enem'
          GROUP BY a.code, a."order", ec.number, s.code, s.description
          ORDER BY a."order", ec.number, s.code
        `
      ),

      // ── Fonte da classificação ENEM (oficial = microdados INEP, ai =
      // inferência por verbo/heurística, sem linha = nunca classificado) ─
      db.execute<{ classification_source_label: string | null; count: number }>(
        sql`
          SELECT COALESCE(c.enem_classification_source, 'nunca_classificado') AS classification_source_label, COUNT(*)::int AS count
          FROM imported_questions q
          LEFT JOIN imported_question_classifications c ON c.question_id = q.id AND c.source = 'enem'
          GROUP BY classification_source_label
          ORDER BY count DESC
        `
      ),

      // ── Eixos Cognitivos ─────────────────────────────────────────
      db.execute<{ axis_code: string | null; count: number }>(
        sql`
          SELECT ax.code AS axis_code, COUNT(*)::int AS count
          FROM imported_question_classifications c
          LEFT JOIN enem_cognitive_axes ax ON ax.id = c.enem_cognitive_axis_id
          WHERE c.source = 'enem'
          GROUP BY ax.code
          ORDER BY count DESC
        `
      ),
      db.execute<{ code: string; name: string }>(sql`SELECT code, name FROM enem_cognitive_axes`),
    ])

  const totalEnem = totalRows[0]?.count ?? 0

  const bloomCounts: Record<string, number> = Object.fromEntries(bloomLevels.map((l) => [l, 0]))
  let bloomClassified = 0
  for (const row of bloomRaw) {
    if (row.level === 'pending') continue
    if (row.level in bloomCounts) {
      bloomCounts[row.level] = row.count
      bloomClassified += row.count
    }
  }

  const axisNames = Object.fromEntries((axisNamesRaw as Array<{ code: string; name: string }>).map((r) => [r.code, r.name]))

  return NextResponse.json({
    total: totalEnem,
    byYear: Object.fromEntries(
      (byYear as Array<{ year: number; count: number }>).map(r => [String(r.year), r.count])
    ),
    byArea: Object.fromEntries(
      (byArea as Array<{ area: string | null; count: number }>).map(r => [r.area ?? 'outros', r.count])
    ),
    bloomCounts,
    bloomClassified,
    bloomPending: totalEnem - bloomClassified,
    matrixStats: matrixStats as Array<{ area: string; count: number; level: string | null }>,
    topSkills: (skillStats as Array<{ skill_code: string | null; skill_description: string | null; count: number }>)
      .slice(0, 10)
      .map(r => ({ skillCode: r.skill_code, skillDescription: r.skill_description, count: r.count })),
    byCompetency: competencyStats as Array<{ area: string; number: number; description: string; count: number }>,
    bySkillInCompetency: (
      skillInCompetencyStats as Array<{ area: string; competency_number: number; skill_code: string | null; skill_description: string | null; count: number }>
    )
      .filter((r) => r.skill_code)
      .map((r) => ({
        area: r.area,
        competencyNumber: r.competency_number,
        skillCode: r.skill_code!,
        skillDescription: r.skill_description,
        count: r.count,
      })),
    classificationSource: Object.fromEntries(
      (sourceStats as Array<{ classification_source_label: string | null; count: number }>).map(r => [r.classification_source_label ?? 'nunca_classificado', r.count])
    ),
    cognitiveAxes: Object.fromEntries(
      (axisStats as Array<{ axis_code: string | null; count: number }>)
        .filter(r => r.axis_code)
        .map(r => [r.axis_code!, r.count])
    ),
    cognitiveAxesNames: axisNames,
  })
}
