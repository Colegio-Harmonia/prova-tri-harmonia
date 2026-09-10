import { NextResponse } from 'next/server'
import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { EXAM_KINDS, generatedExams, users } from '@/db/schema'
import { auth } from '@/auth/auth'
import { isStaffSuperuser } from '@/lib/auth/roles'

// Só os valores que existem de verdade nas provas que o usuário pode ver
// (nunca o catálogo estático de disciplinas/anos — senão o filtro mostra
// opções sem nenhuma prova por trás, uma lista vazia sempre que escolhida).
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 })

  const params = new URL(req.url).searchParams
  const examKind = params.get('examKind')
  const includeArchived = params.get('archived') === 'true'
  const scopeConditions = []
  if (!isStaffSuperuser(currentUser.role)) {
    scopeConditions.push(
      examKind === 'reforco_enem' || examKind === 'atividade'
        ? or(eq(generatedExams.createdBy, currentUser.id), eq(generatedExams.assignedTo, currentUser.id))
        : eq(generatedExams.assignedTo, currentUser.id),
    )
  }
  if (examKind && (EXAM_KINDS as readonly string[]).includes(examKind)) {
    scopeConditions.push(eq(generatedExams.examKind, examKind as (typeof EXAM_KINDS)[number]))
  }
  scopeConditions.push(includeArchived ? isNotNull(generatedExams.archivedAt) : isNull(generatedExams.archivedAt))
  const scope = scopeConditions.length ? and(...scopeConditions) : undefined

  const [subjectRows, yearRows] = await Promise.all([
    db.selectDistinct({ subject: generatedExams.subject }).from(generatedExams).where(scope).orderBy(generatedExams.subject),
    db
      .select({ academicYear: generatedExams.academicYear, count: sql<number>`count(*)::int` })
      .from(generatedExams)
      .where(scope)
      .groupBy(generatedExams.academicYear)
      .orderBy(generatedExams.academicYear),
  ])

  const activeUsers = await db.query.users.findMany({
    where: eq(users.active, true),
    columns: { id: true, name: true, email: true },
  })

  return NextResponse.json({
    subjects: subjectRows.map((r) => r.subject),
    academicYears: yearRows.map((r) => r.academicYear),
    assignees: isStaffSuperuser(currentUser.role) ? activeUsers : [],
  })
}
