import { eq, inArray } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { pedagogicalInterventions, users } from '@/db/schema'
import { canonicalSubject, evidenceConditions, loadEvidence, loadPlannedSkills } from '@/lib/curriculum/masteryData'
import { buildTrajectory, TRAJECTORY_RULES } from '@/lib/curriculum/trajectory'

// Trajetória anual (Bloco 6): de um aluno (`studentId` ou `student`) ou de
// uma turma (`classroomCourseId`). O escopo de acesso é o mesmo do domínio
// individual: professor só vê as provas atribuídas a ele.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const student = params.get('studentId')?.trim() || params.get('student')?.trim()
  const classroomCourseId = params.get('classroomCourseId')?.trim()
  if (!student && !classroomCourseId) return NextResponse.json({ error: 'Informe o aluno ou a turma.' }, { status: 400 })
  // A trajetória compara bimestres: um filtro de bimestre anularia a comparação.
  const scoped = new URLSearchParams(params)
  scoped.delete('bimester')

  const { evidence, scopes } = await loadEvidence(evidenceConditions(currentUser, scoped))
  const evaluatedGroups = new Map([...scopes.values()].map((scope) => [`${scope.academicYear}:${scope.segment}:${scope.gradeYear}:${canonicalSubject(scope.subject)}`, scope]))
  const years = [...new Set([...scopes.values()].map((scope) => scope.academicYear))]
  // Todos os bimestres planejados das disciplinas avaliadas, para a cobertura acumulada.
  const planned = await loadPlannedSkills(years, (plan) => {
    const scope = evaluatedGroups.get(`${plan.academicYear}:${plan.segment}:${plan.gradeYear}:${canonicalSubject(plan.subject)}`)
    return scope ? { ...scope, bimester: plan.bimester } : null
  })
  const interventions = years.length ? await db.select().from(pedagogicalInterventions).where(inArray(pedagogicalInterventions.academicYear, years)) : []

  const trajectories = buildTrajectory(evidence, planned, interventions.map((row) => ({
    id: row.id, segment: row.segment, gradeYear: row.gradeYear, subject: row.subject, academicYear: row.academicYear,
    action: row.action, ownerName: row.ownerName, status: row.status, dueDate: row.dueDate, createdAt: row.createdAt.toISOString(), skillCodes: row.skillCodes,
  })))

  return NextResponse.json({
    mode: student ? 'aluno' : 'turma',
    studentCount: new Set(evidence.map((item) => item.studentKey)).size,
    trajectories,
    rules: TRAJECTORY_RULES,
  })
}
