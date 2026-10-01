import { and, desc, eq, gte } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { aiModelProfiles, aiOperations, jevDecisions, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'

function periodStart(value: string | null) {
  const now = new Date()
  if (value === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (value === '7d') return new Date(now.getTime() - 7 * 86_400_000)
  if (value === '30d') return new Date(now.getTime() - 30 * 86_400_000)
  return null
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser || !isStaffSuperuser(currentUser.role)) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })

  const period = req.nextUrl.searchParams.get('period') ?? 'all'
  const start = periodStart(period)
  const operations = await db.query.aiOperations.findMany({
    where: start ? gte(aiOperations.createdAt, start) : undefined,
    orderBy: (table) => [desc(table.createdAt)],
    limit: 100,
  })
  const decisions = await db.query.jevDecisions.findMany({
    where: start ? gte(jevDecisions.createdAt, start) : undefined,
    orderBy: (table) => [desc(table.createdAt)],
    limit: 500,
  })
  const profiles = await db.query.aiModelProfiles.findMany()
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
  const resolved = operations.map((operation) => {
    if (operation.estimatedCostMicrousd !== null) return { ...operation, effectiveCostMicrousd: operation.estimatedCostMicrousd, costStatus: 'recorded' as const }
    // Operações históricas podem não ter profileId (antes da telemetria
    // completa). Reutilizamos somente um perfil com mesmo provedor/modelo;
    // se não houver tarifa inequívoca, mantemos como não precificada.
    const profile = operation.modelProfileId
      ? profileById.get(operation.modelProfileId)
      : profiles.find((candidate) => candidate.provider === operation.provider && candidate.model === operation.model)
    if (!profile) return { ...operation, effectiveCostMicrousd: null, costStatus: 'unpriced' as const }
    const value = profile.imageCostMicrousd ?? (profile.inputCostMicrousdPerMillion !== null && profile.outputCostMicrousdPerMillion !== null
      ? Math.round(((operation.promptTokens ?? 0) * profile.inputCostMicrousdPerMillion + (operation.completionTokens ?? 0) * profile.outputCostMicrousdPerMillion) / 1_000_000)
      : null)
    return { ...operation, effectiveCostMicrousd: value, costStatus: value === null ? 'unpriced' as const : 'recalculated' as const }
  })
  const summary = resolved.reduce((result, operation) => ({
    total: result.total + 1,
    succeeded: result.succeeded + Number(operation.status === 'succeeded'),
    rejected: result.rejected + Number(operation.status === 'rejected'),
    failed: result.failed + Number(operation.status === 'failed'),
    totalTokens: result.totalTokens + (operation.totalTokens ?? 0),
    estimatedCostMicrousd: result.estimatedCostMicrousd + (operation.effectiveCostMicrousd ?? 0),
    unpriced: result.unpriced + Number(operation.effectiveCostMicrousd === null),
  }), { total: 0, succeeded: 0, rejected: 0, failed: 0, totalTokens: 0, estimatedCostMicrousd: 0, unpriced: 0 })

  const jevByOperation = new Map<string, { operation: string; total: number; provider: number; cache: number; fallback: number; automatic: number; review: number; failed: number }>()
  const jevSummary = { total: 0, provider: 0, cache: 0, fallback: 0, automatic: 0, review: 0, failed: 0 }
  for (const decision of decisions) {
    const group = jevByOperation.get(decision.operation) ?? { operation: decision.operation, total: 0, provider: 0, cache: 0, fallback: 0, automatic: 0, review: 0, failed: 0 }
    group.total++; jevSummary.total++
    group[decision.source]++; jevSummary[decision.source]++
    if (decision.route === 'automatic') { group.automatic++; jevSummary.automatic++ }
    if (decision.route === 'review') { group.review++; jevSummary.review++ }
    if (decision.status === 'failed') { group.failed++; jevSummary.failed++ }
    jevByOperation.set(decision.operation, group)
  }
  const jev = {
    summary: jevSummary,
    byOperation: [...jevByOperation.values()].sort((left, right) => right.total - left.total || left.operation.localeCompare(right.operation)),
    truncated: decisions.length === 500,
  }

  return NextResponse.json({ summary, operations: resolved.slice(0, 100), jev })
}
