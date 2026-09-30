import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { enrichBnccDescriptions } from '@/lib/curriculum/bnccDescriptions'
import { evidenceConditions, loadEvidence, loadPlannedSkills, scopeKey } from '@/lib/curriculum/masteryData'
import { calculateStudentMastery, consolidateMastery, MASTERY_LEVELS, MASTERY_RULES, type MasteryLevel } from '@/lib/curriculum/studentMastery'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 401 })

  const params = req.nextUrl.searchParams
  if (!params.get('student')?.trim() && !params.get('studentId')?.trim()) return NextResponse.json({ error: 'Informe o aluno.' }, { status: 400 })

  const { evidence, scopes } = await loadEvidence(evidenceConditions(currentUser, params))
  const years = [...new Set([...scopes.values()].map((scope) => scope.academicYear))]
  // Só os recortes em que o aluno foi avaliado: habilidade planejada de outro bimestre não entra aqui.
  const plannedSkills = await loadPlannedSkills(years, (plan) => scopes.get(scopeKey(plan)) ?? null)

  const rows = calculateStudentMastery(await enrichBnccDescriptions(plannedSkills), evidence)
  const levelCounts = Object.fromEntries(MASTERY_LEVELS.map((level) => [level, rows.filter((row) => row.level === level).length])) as Record<MasteryLevel, number>
  return NextResponse.json({
    rows,
    consolidated: consolidateMastery(rows, evidence),
    summary: {
      plannedSkillCount: rows.filter((row) => row.planned).length,
      observedSkillCount: rows.filter((row) => row.itemCount > 0).length,
      outsidePlanCount: rows.filter((row) => !row.planned).length,
      limitedBySampleCount: rows.filter((row) => row.limitedBySample).length,
      levelCounts,
    },
    rules: MASTERY_RULES,
  })
}
