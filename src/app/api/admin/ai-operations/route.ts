import { desc, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { aiOperations, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'

export async function GET() {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser || !isStaffSuperuser(currentUser.role)) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })

  const operations = await db.query.aiOperations.findMany({
    orderBy: (table) => [desc(table.createdAt)],
    limit: 100,
  })
  const summary = operations.reduce((result, operation) => ({
    total: result.total + 1,
    succeeded: result.succeeded + Number(operation.status === 'succeeded'),
    rejected: result.rejected + Number(operation.status === 'rejected'),
    failed: result.failed + Number(operation.status === 'failed'),
    totalTokens: result.totalTokens + (operation.totalTokens ?? 0),
    estimatedCostMicrousd: result.estimatedCostMicrousd + (operation.estimatedCostMicrousd ?? 0),
  }), { total: 0, succeeded: 0, rejected: 0, failed: 0, totalTokens: 0, estimatedCostMicrousd: 0 })

  return NextResponse.json({ summary, operations: operations.slice(0, 30) })
}
