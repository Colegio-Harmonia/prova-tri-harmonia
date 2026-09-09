import { NextRequest, NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { auth } from '@/auth/auth'

const AREAS = ['linguagens', 'matematica', 'ciencias-natureza', 'ciencias-humanas']

/**
 * Lista as habilidades oficiais (H1-H30) de uma área, pra popular o
 * dropdown de filtro na busca do banco ENEM — vem direto da matriz
 * cadastrada (enem_skills), não das questões importadas, então mostra
 * todas as 30 mesmo que o banco ainda não tenha questão pra alguma.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const area = searchParams.get('area')
  if (!area || !AREAS.includes(area)) {
    return NextResponse.json({ error: 'Parâmetro "area" inválido ou ausente.' }, { status: 400 })
  }

  const rows = await db.execute<{ code: string; description: string; number: number }>(
    sql`
      SELECT s.code, s.description, ec.number
      FROM enem_skills s
      JOIN enem_competencies ec ON ec.id = s.competency_id
      JOIN enem_areas a ON a.id = ec.area_id
      WHERE a.code = ${area}
      ORDER BY ec.number, s.code
    `,
  )

  return NextResponse.json({
    skills: (rows as Array<{ code: string; description: string; number: number }>).map((r) => ({
      code: r.code,
      description: r.description,
      competencyNumber: r.number,
    })),
  })
}
