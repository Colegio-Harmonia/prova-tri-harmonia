import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, inArray } from 'drizzle-orm'
import { auth } from '@/auth/auth'
import { db } from '@/db/client'
import { administrativeAudit, aiBudgetControls, aiBudgetResets, users } from '@/db/schema'
import { AI_BUDGET_PURPOSES, getAiBudgetSnapshot, type AiBudgetPurpose } from '@/lib/ai/operationBudget'
import { isStaffSuperuser } from '@/lib/auth/roles'

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.email) return null
  const user = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  return user && isStaffSuperuser(user.role) ? user : null
}

export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  return NextResponse.json({ budgets: await getAiBudgetSnapshot() })
}

const bodySchema = z.object({
  purpose: z.enum(AI_BUDGET_PURPOSES as [string, ...string[]]).nullable().optional(),
  disabled: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Finalidade inválida.' }, { status: 400 })
  const purpose = (parsed.data.purpose as AiBudgetPurpose | null | undefined) ?? null

  if (typeof parsed.data.disabled === 'boolean') {
    const purposes = purpose ? [purpose] : AI_BUDGET_PURPOSES
    const previous = await db.query.aiBudgetControls.findMany({
      where: inArray(aiBudgetControls.purpose, purposes),
    })
    const updatedAt = new Date()
    await db.transaction(async (tx) => {
      for (const targetPurpose of purposes) {
        await tx.insert(aiBudgetControls).values({ purpose: targetPurpose, disabled: parsed.data.disabled!, updatedBy: admin.id, updatedAt })
          .onConflictDoUpdate({ target: aiBudgetControls.purpose, set: { disabled: parsed.data.disabled!, updatedBy: admin.id, updatedAt } })
      }
    })
    await db.insert(administrativeAudit).values({
      actorId: admin.id,
      action: 'ai_budget_limit_toggled',
      previousValue: previous.map((item) => ({ purpose: item.purpose, disabled: item.disabled })),
      nextValue: { purpose: purpose ?? 'todas', disabled: parsed.data.disabled },
    })
    return NextResponse.json({ ok: true, budgets: await getAiBudgetSnapshot() })
  }

  const [reset] = await db.insert(aiBudgetResets).values({ purpose, resetBy: admin.id }).returning()
  await db.insert(administrativeAudit).values({ actorId: admin.id, action: 'ai_budget_reset', previousValue: null, nextValue: { purpose: purpose ?? 'todas', resetId: reset.id } })
  return NextResponse.json({ ok: true, budgets: await getAiBudgetSnapshot() })
}
