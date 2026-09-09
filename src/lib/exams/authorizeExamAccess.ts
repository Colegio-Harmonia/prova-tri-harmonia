import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'

// Falha de segurança real corrigida 17/07/2026 (Subtarefa 7): 7 rotas de
// prova (detalhe + regenerate/review-note/toggle-image/request-image/
// import-image/regenerate-question) só checavam "está logado", nunca "essa
// prova é sua" — qualquer professor conseguia ver E EDITAR prova de
// colega só sabendo o ID numérico. "É sua" = você criou OU foi atribuída
// a você (regra do plano: "provas criadas por eles ou para eles").
// Coordenação/Direção sempre passam (isStaffSuperuser).
export async function authorizeExamAccess(examId: number, userEmail: string) {
  const currentUser = await db.query.users.findFirst({ where: eq(users.email, userEmail) })
  if (!currentUser) return { error: NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 }) } as const

  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
  if (!exam) return { error: NextResponse.json({ error: 'Prova não encontrada' }, { status: 404 }) } as const

  const isOwner = exam.createdBy === currentUser.id || exam.assignedTo === currentUser.id
  if (!isStaffSuperuser(currentUser.role) && !isOwner) {
    return { error: NextResponse.json({ error: 'Você não tem permissão pra acessar essa prova.' }, { status: 403 }) } as const
  }

  return { currentUser, exam } as const
}
