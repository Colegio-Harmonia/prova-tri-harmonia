import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { administrativeAudit, googleChatInstallations, users } from '@/db/schema'
import { auth } from '@/auth/auth'
import { isStaffSuperuser } from '@/lib/auth/roles'

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(['professor', 'coordenacao', 'direcao']).optional(),
  active: z.boolean().optional(),
})

const deleteSchema = z.object({
  transferToUserId: z.number().int().positive().optional(),
})

// Todos os vínculos que impedem apagar uma conta são tratados de forma
// explícita. Não usamos CASCADE: a decisão de transferir o histórico é sempre
// tomada pelo administrador na tela de Usuários.
const USER_HISTORY_REFERENCES = [
  ['adapted_exams', 'approved_by'],
  ['adapted_exams', 'created_by'],
  ['administrative_audit', 'actor_id'],
  ['curriculum_tab_overrides', 'updated_by'],
  ['enem_sae_imports', 'imported_by'],
  ['exam_corrections', 'created_by'],
  ['exam_scan_audit_events', 'actor_id'],
  ['exam_scan_processing_attempts', 'requested_by'],
  ['exam_scan_readings', 'reviewed_by'],
  ['exam_scan_uploads', 'created_by'],
  ['exam_sheet_assignments', 'emitted_by'],
  ['exam_sheet_assignments', 'issued_by'],
  ['exam_sheet_assignments', 'voided_by'],
  ['generated_exams', 'assigned_by'],
  ['generated_exams', 'assigned_to'],
  ['generated_exams', 'created_by'],
  ['generation_batches', 'requested_by'],
  ['generation_jobs', 'requested_by'],
  ['imported_question_classifications', 'classified_by'],
  ['pedagogical_classification_audit', 'performed_by'],
  ['pedagogical_classifications', 'approved_by'],
  ['pedagogical_classifications', 'created_by'],
] as const

type UserHistorySummary = { records: number; exams: number }

async function userHistorySummary(userId: number): Promise<UserHistorySummary> {
  const counts = await Promise.all(USER_HISTORY_REFERENCES.map(async ([table, column]) => {
    const [row] = await db.execute<{ count: number | string }>(sql.raw(
      `SELECT COUNT(*)::int AS count FROM "${table}" WHERE "${column}" = ${userId}`,
    ))
    return Number(row?.count ?? 0)
  }))
  const [examRow] = await db.execute<{ count: number | string }>(sql.raw(
    `SELECT COUNT(DISTINCT "id")::int AS count FROM "generated_exams" WHERE "created_by" = ${userId} OR "assigned_by" = ${userId} OR "assigned_to" = ${userId}`,
  ))
  return { records: counts.reduce((total, count) => total + count, 0), exams: Number(examRow?.count ?? 0) }
}

// Edita cargo/nome/ativo — nunca e-mail (é a chave que casa com o login
// Google, trocar isso desvincularia a conta) nem senha (fluxo próprio via
// scripts/create-user.ts, fora do escopo dessa tela).
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const targetId = Number(params.id)
  if (!Number.isFinite(targetId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser || !isStaffSuperuser(currentUser.role)) {
    return NextResponse.json({ error: 'Só coordenação/direção pode editar usuários.' }, { status: 403 })
  }

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Parâmetros inválidos', issues: parsed.error.issues }, { status: 400 })

  // Ninguém desativa a própria conta por essa tela — evita um superusuário
  // se trancar fora do sistema sem querer, sem ter outro admin por perto.
  if (targetId === currentUser.id && parsed.data.active === false) {
    return NextResponse.json({ error: 'Você não pode desativar sua própria conta.' }, { status: 400 })
  }

  const previous = await db.query.users.findFirst({ where: eq(users.id, targetId) })
  if (!previous) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const [updated] = await db
    .update(users)
    .set(parsed.data)
    .where(eq(users.id, targetId))
    .returning({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active })

  if (!updated) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
  await db.insert(administrativeAudit).values({
    action: parsed.data.active !== undefined ? (parsed.data.active ? 'user_activated' : 'user_deactivated') : 'user_updated',
    actorId: currentUser.id,
    targetUserId: updated.id,
    previousValue: { name: previous.name, role: previous.role, active: previous.active },
    nextValue: { name: updated.name, role: updated.role, active: updated.active },
  })
  return NextResponse.json({ user: updated })
}

function hasForeignKeyViolation(error: unknown): boolean {
  // O driver pode devolver o erro do PostgreSQL diretamente ou embrulhá-lo em
  // `cause` (como o Drizzle faz dentro de transações). Nos dois casos devemos
  // devolver uma resposta JSON utilizável pela tela, e não deixar o Next gerar
  // uma resposta 500 sem corpo.
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { code?: string; cause?: unknown }
  return candidate.code === '23503' || hasForeignKeyViolation(candidate.cause)
}

// Exclusão é reservada a contas sem histórico pedagógico/operacional. Se o
// usuário já aparece em provas, correções ou outras evidências, o banco
// bloqueia a remoção e a tela orienta a desativação — que preserva o histórico.
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const session = await auth()
  if (!session?.user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const targetId = Number(params.id)
  if (!Number.isFinite(targetId)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const currentUser = await db.query.users.findFirst({ where: eq(users.email, session.user.email) })
  if (!currentUser || !isStaffSuperuser(currentUser.role)) {
    return NextResponse.json({ error: 'Só coordenação/direção pode excluir usuários.' }, { status: 403 })
  }
  if (targetId === currentUser.id) {
    return NextResponse.json({ error: 'Você não pode excluir sua própria conta.' }, { status: 400 })
  }

  const previous = await db.query.users.findFirst({ where: eq(users.id, targetId) })
  if (!previous) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const payload = deleteSchema.safeParse(await _req.json().catch(() => ({})))
  if (!payload.success) return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 })

  const history = await userHistorySummary(targetId)
  if (history.records > 0 && !payload.data.transferToUserId) {
    return NextResponse.json({
      error: 'Esta conta possui histórico no sistema. Escolha quem receberá esse histórico antes de excluí-la.',
      requiresTransfer: true,
      history,
    }, { status: 409 })
  }

  let transferTo: typeof currentUser | null = null
  if (payload.data.transferToUserId) {
    if (payload.data.transferToUserId === targetId) {
      return NextResponse.json({ error: 'Escolha outro usuário para receber o histórico.' }, { status: 400 })
    }
    transferTo = await db.query.users.findFirst({ where: eq(users.id, payload.data.transferToUserId) }) ?? null
    if (!transferTo || !transferTo.active) {
      return NextResponse.json({ error: 'O usuário escolhido para receber o histórico não está ativo.' }, { status: 400 })
    }
  }

  try {
    const deleted = await db.transaction(async (tx) => {
      // A instalação de Chat é acessória à conta; removê-la revoga também o
      // vínculo de notificações antes da exclusão da conta.
      await tx.delete(googleChatInstallations).where(eq(googleChatInstallations.userId, targetId))

      if (transferTo) {
        for (const [table, column] of USER_HISTORY_REFERENCES) {
          await tx.execute(sql.raw(
            `UPDATE "${table}" SET "${column}" = ${transferTo.id} WHERE "${column}" = ${targetId}`,
          ))
        }
      }

      // A auditoria é gravada antes da exclusão. A FK com ON DELETE SET NULL
      // mantém o evento e os dados do usuário em previousValue.
      await tx.insert(administrativeAudit).values({
        action: 'user_deleted',
        actorId: currentUser.id,
        targetUserId: previous.id,
        previousValue: { name: previous.name, email: previous.email, role: previous.role, active: previous.active },
        nextValue: transferTo ? { transferredToUserId: transferTo.id, transferredToName: transferTo.name, history } : null,
      })

      const [removed] = await tx
        .delete(users)
        .where(eq(users.id, targetId))
        .returning({ id: users.id, name: users.name, email: users.email })
      return removed ?? null
    })
    if (!deleted) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
    return NextResponse.json({ user: deleted })
  } catch (error) {
    if (hasForeignKeyViolation(error)) {
      return NextResponse.json({ error: 'Esta conta possui histórico no sistema e não pode ser excluída. Desative o acesso para preservar os registros.' }, { status: 409 })
    }
    throw error
  }
}
