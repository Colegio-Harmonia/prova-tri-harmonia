import { NextRequest, NextResponse } from 'next/server'
import { eq, inArray } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { generatedExams, users } from '@/db/schema'
import { enrichBnccDescriptions } from '@/lib/curriculum/bnccDescriptions'
import { canonicalSubject, evidenceConditions, loadEvidence, loadPlannedSkills } from '@/lib/curriculum/masteryData'
import { approvedPrerequisitesFor } from '@/lib/curriculum/prerequisiteService'
import { buildSkillNetwork, NETWORK_RULES } from '@/lib/curriculum/skillNetwork'
import { calculateStudentMastery, MASTERY_RULES, type MasteryScope } from '@/lib/curriculum/studentMastery'

// Sinapse: teia de habilidades do aluno. Os nós são as habilidades planejadas
// no ano (todos os bimestres) das disciplinas em que o aluno foi avaliado, mais
// as observadas fora do plano. As ligações aprendidas usam os colegas do mesmo
// recorte, sempre dentro do escopo de acesso de quem consulta.
function contextKey(scope: Omit<MasteryScope, 'bimester'>) {
  return `${scope.academicYear}:${scope.segment}:${scope.gradeYear}:${canonicalSubject(scope.subject)}`
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 401 })

  const params = req.nextUrl.searchParams
  if (!params.get('student')?.trim() && !params.get('studentId')?.trim()) return NextResponse.json({ error: 'Informe o aluno.' }, { status: 400 })

  // O bimestre não recorta a teia: ela mostra o ano para enxergar o que vem depois.
  const studentParams = new URLSearchParams(params)
  studentParams.delete('bimester')
  const { evidence, scopes } = await loadEvidence(evidenceConditions(currentUser, studentParams))
  const contexts = new Set([...scopes.values()].map(contextKey))
  const years = [...new Set([...scopes.values()].map((scope) => scope.academicYear))]
  const grades = [...new Set([...scopes.values()].map((scope) => scope.gradeYear))]

  const plannedSkills = await loadPlannedSkills(years, (plan) => (contexts.has(contextKey(plan)) ? plan : null))
  const rows = calculateStudentMastery(await enrichBnccDescriptions(plannedSkills), evidence)

  let peers: Awaited<ReturnType<typeof loadEvidence>>['evidence'] = []
  if (years.length) {
    const peerParams = new URLSearchParams(studentParams)
    for (const key of ['student', 'studentId', 'examId', 'classroomCourseId']) peerParams.delete(key)
    const conditions = [...evidenceConditions(currentUser, peerParams), inArray(generatedExams.academicYear, years), inArray(generatedExams.gradeYear, grades)]
    peers = (await loadEvidence(conditions)).evidence.filter((item) => contexts.has(contextKey(item)))
  }

  // Só pré-requisitos aprovados pela coordenação entram na teia.
  const prerequisites = await approvedPrerequisitesFor(rows.map((row) => row.code))
  return NextResponse.json({ ...buildSkillNetwork(rows, peers, prerequisites), rules: { network: NETWORK_RULES, mastery: MASTERY_RULES } })
}
