import { NextResponse } from 'next/server'
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { generatedExams, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { isInsufficientScopeError, listMyCourses } from '@/lib/classroom/classroomClient'

// Esta rota é a interseção deliberada entre o Classroom do professor e as
// provas formais que estão no Prova-TRI. Não expõe cursos sem uma prova
// vinculada e respeita a mesma regra de atribuição usada na lista de provas.
export async function GET() {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (session.googleError === 'RefreshAccessTokenError') {
    return NextResponse.json({ error: 'reauth_required', message: 'Sua conexão com o Google expirou, entre novamente.' }, { status: 401 })
  }
  if (!session.googleAccessToken) {
    return NextResponse.json({ error: 'google_not_connected', message: 'Entre com sua conta Google pra ver suas turmas do Classroom.' }, { status: 401 })
  }

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email), columns: { id: true, role: true } })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  try {
    const [classroomCourses, proofs] = await Promise.all([
      listMyCourses(session.googleAccessToken),
      db
        .select({ classroomCourseId: generatedExams.classroomCourseId, createdAt: generatedExams.createdAt, status: generatedExams.status })
        .from(generatedExams)
        .where(and(
          eq(generatedExams.examKind, 'prova'),
          isNotNull(generatedExams.classroomCourseId),
          ...(!isStaffSuperuser(currentUser.role) ? [eq(generatedExams.assignedTo, currentUser.id)] : []),
        ))
        .orderBy(desc(generatedExams.createdAt)),
    ])

    const summaries = new Map<string, { examCount: number; latestExamAt: Date | null; appliedCount: number }>()
    for (const proof of proofs) {
      if (!proof.classroomCourseId) continue
      const current = summaries.get(proof.classroomCourseId) ?? { examCount: 0, latestExamAt: null, appliedCount: 0 }
      current.examCount += 1
      if (!current.latestExamAt || proof.createdAt > current.latestExamAt) current.latestExamAt = proof.createdAt
      if (proof.status === 'aplicado' || proof.status === 'corrigido') current.appliedCount += 1
      summaries.set(proof.classroomCourseId, current)
    }

    const courses = classroomCourses
      .filter((course) => summaries.has(course.id))
      .map((course) => ({ ...course, ...summaries.get(course.id)! }))
      .sort((a, b) => (b.latestExamAt?.getTime() ?? 0) - (a.latestExamAt?.getTime() ?? 0))

    return NextResponse.json({ courses })
  } catch (err) {
    if (isInsufficientScopeError(err)) {
      return NextResponse.json({ error: 'reauth_required', message: 'Sua conta Google precisa autorizar de novo — entre com o Google outra vez.' }, { status: 401 })
    }
    console.error('[api/turmas] falha ao cruzar turmas e provas:', err)
    return NextResponse.json({ error: 'classroom_api_error', message: 'Não consegui carregar as turmas com provas vinculadas.' }, { status: 502 })
  }
}
