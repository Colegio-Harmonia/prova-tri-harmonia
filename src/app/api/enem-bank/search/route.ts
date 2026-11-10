import { getEnemAreaForSubject } from '@/config/enemAreaMap'
import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { auth } from '@/auth/auth'

const AREAS = ['linguagens', 'matematica', 'ciencias-natureza', 'ciencias-humanas']

/**
 * Lista candidatas do banco de questões reais do ENEM (`imported_questions`)
 * pra seleção manual na tela de geração — a coordenação escolhe quais
 * entram na prova, o sistema nunca escolhe sozinho (decisão confirmada).
 * Questões visuais entram normalmente: o recorte oficial salvo no Drive é
 * levado para a revisão e para o documento pelo mesmo pipeline de imagens.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const area = searchParams.get('area')
  if (!area || !AREAS.includes(area)) {
    return NextResponse.json({ error: 'Parâmetro "area" inválido ou ausente.' }, { status: 400 })
  }
  const subject = searchParams.get('subject')
  if (subject && getEnemAreaForSubject(subject) !== area) return NextResponse.json({ error: 'A disciplina não corresponde à área ENEM.' }, { status: 400 })
  const language = subject && /ingl/i.test(subject) ? 'ingles' : subject && /espan/i.test(subject) ? 'espanhol' : ''
  const yearParam = searchParams.get('year')
  const year = yearParam ? Number(yearParam) : null
  const limit = Number(searchParams.get('limit') ?? 40)
  const offset = Number(searchParams.get('offset') ?? 0)
  const questionIndexParam = searchParams.get('questionIndex')
  const questionIndex = questionIndexParam ? Number(questionIndexParam) : null
  const query = searchParams.get('q')?.trim() || null
  if ((year !== null && (!Number.isInteger(year) || year < 1998 || year > 2100))
    || !Number.isInteger(limit) || limit < 1 || limit > 100
    || !Number.isInteger(offset) || offset < 0 || offset > 100000
    || (questionIndex !== null && (!Number.isInteger(questionIndex) || questionIndex < 1 || questionIndex > 180))) {
    return NextResponse.json({ error: 'Ano, número da questão ou paginação inválidos.' }, { status: 400 })
  }
  const bloomLevel = searchParams.get('bloomLevel') || null
  const skillCode = searchParams.get('skillCode') || null
  const cognitiveAxis = searchParams.get('cognitiveAxis') || null

  const rows = await db.execute<{
    id: number
    year: number
    question_index: number
    bncc_codes: string[] | null
    context: string | null
    alternatives_introduction: string | null
    skill_code: string | null
    skill_description: string | null
    competency_number: number | null
    classification_source: string | null
    bloom_level: string | null
    axis_code: string | null
  }>(
    sql`
      SELECT
        q.id, q.year, q.question_index, q.context, q.alternatives_introduction,
        q.raw_json->'bnccClassification'->'bnccCodes' AS bncc_codes,
        s.code AS skill_code, s.description AS skill_description,
        ec.number AS competency_number,
        c.enem_classification_source AS classification_source,
        c.bloom_level, ax.code AS axis_code
      FROM imported_questions q
      LEFT JOIN imported_question_classifications c ON c.question_id = q.id AND c.source = 'enem'
      LEFT JOIN enem_skills s ON s.id = c.enem_skill_id
      LEFT JOIN enem_competencies ec ON ec.id = c.enem_competency_id
      LEFT JOIN enem_cognitive_axes ax ON ax.id = c.enem_cognitive_axis_id
      WHERE q.source = 'enem' AND q.discipline = ${area}
        AND COALESCE(q.language, '') = ${language}
        ${year ? sql`AND q.year = ${year}` : sql``}
        ${questionIndex ? sql`AND q.question_index = ${questionIndex}` : sql``}
        ${query ? sql`AND concat_ws(' ', q.context, q.alternatives_introduction, q.title) ILIKE ${`%${query}%`}` : sql``}
        ${bloomLevel ? sql`AND c.bloom_level = ${bloomLevel}` : sql``}
        ${skillCode ? sql`AND s.code = ${skillCode}` : sql``}
        ${cognitiveAxis ? sql`AND ax.code = ${cognitiveAxis}` : sql``}
      ORDER BY q.year DESC, q.question_index ASC, q.id ASC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `,
  )

  return NextResponse.json({
    hasMore: rows.length > limit,
    questions: rows.slice(0, limit).map((r) => ({
      id: r.id,
      year: r.year,
      questionIndex: r.question_index,
      preview: (r.context ?? r.alternatives_introduction ?? '').slice(0, 220),
      skillCode: r.skill_code,
      skillDescription: r.skill_description,
      competencyNumber: r.competency_number,
      classificationSource: r.classification_source ?? 'nunca_classificado',
      bloomLevel: r.bloom_level,
      cognitiveAxis: r.axis_code,
      bnccCodes: r.bncc_codes ?? [],
    })),
  })
}
