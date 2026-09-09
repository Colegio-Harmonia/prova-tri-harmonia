import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { generatedExams, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'

export const CORRECTABLE_STATUSES = ['aplicado', 'corrigido']

// Compartilhado entre as rotas de correção (route.ts do App Router só pode
// exportar handlers HTTP — helpers precisam morar fora daquele arquivo).
export async function loadExamAndAuthorize(examId: number, userEmail: string) {
  const currentUser = await db.query.users.findFirst({ where: eq(users.email, userEmail) })
  if (!currentUser) return { error: NextResponse.json({ error: 'Usuário não encontrado' }, { status: 401 }) } as const

  const exam = await db.query.generatedExams.findFirst({ where: eq(generatedExams.id, examId) })
  if (!exam) return { error: NextResponse.json({ error: 'Prova não encontrada' }, { status: 404 }) } as const

  const isCoordenacao = isStaffSuperuser(currentUser.role)
  const isAssignee = exam.assignedTo === currentUser.id
  if (!isCoordenacao && !isAssignee) {
    return { error: NextResponse.json({ error: 'Você não tem permissão pra corrigir essa prova.' }, { status: 403 }) } as const
  }

  return { currentUser, exam } as const
}
