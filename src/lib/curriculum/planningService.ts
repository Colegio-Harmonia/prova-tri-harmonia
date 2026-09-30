// Planejamento pedagógico interno (Bloco 7). Toda escrita passa por aqui e
// pela política em planningPolicy.ts; as rotas só validam entrada e chamam.

import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  curriculumPlanAssignments, curriculumPlans, curriculumPlanSkills, curriculumPlanStatusHistory,
  curriculumPlanUnits, curriculumPlanVersions, users,
} from '@/db/schema'
import { isStaffSuperuser, type UserRole } from '@/lib/auth/roles'
import { enrichBnccDescriptions } from './bnccDescriptions'
import { recordDecision, skillDiff } from './decisionLog'
import {
  canEditPlan, canReceiveNewDraft, canStartNewVersion, canTransitionPlan, canViewPlan, normalizePlanUnits,
  officialVersion, openVersion, validatePlanScope, type PlanningStatus, type PlanUnitInput,
} from './planningPolicy'

export class PlanningError extends Error {
  constructor(message: string, public readonly status = 400, public readonly details?: string[]) { super(message) }
}

export type Viewer = { id: number; role: UserRole }
export type PlanScope = { academicYear: number; segment: 'anos-iniciais' | 'anos-finais' | 'ensino-medio'; gradeYear: number; subject: string; bimester: number }

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function assignedUserIds(planId: number, tx: Tx | typeof db = db) {
  const rows = await tx.select({ userId: curriculumPlanAssignments.userId }).from(curriculumPlanAssignments).where(eq(curriculumPlanAssignments.planId, planId))
  return rows.map((row) => row.userId)
}

async function accessContext(viewer: Viewer, planId: number, tx: Tx | typeof db = db) {
  return { role: viewer.role, userId: viewer.id, assignedUserIds: await assignedUserIds(planId, tx) }
}

async function versionsOf(planId: number, tx: Tx | typeof db = db) {
  return tx.select().from(curriculumPlanVersions).where(eq(curriculumPlanVersions.planId, planId)).orderBy(asc(curriculumPlanVersions.versionNumber))
}

function requireManager(viewer: Viewer) {
  if (!isStaffSuperuser(viewer.role)) throw new PlanningError('Ação restrita à coordenação e à direção.', 403)
}

async function versionContent(versionId: number, tx: Tx | typeof db = db) {
  const units = await tx.select().from(curriculumPlanUnits).where(eq(curriculumPlanUnits.versionId, versionId)).orderBy(asc(curriculumPlanUnits.position))
  const skills = units.length ? await tx.select().from(curriculumPlanSkills).where(inArray(curriculumPlanSkills.unitId, units.map((unit) => unit.id))).orderBy(asc(curriculumPlanSkills.position)) : []
  return units.map((unit) => ({
    title: unit.title, content: unit.content, objectives: unit.objectives,
    skills: skills.filter((skill) => skill.unitId === unit.id).map((skill) => ({ code: skill.code, description: skill.description, targetMasteryPercent: skill.targetMasteryPercent })),
  }))
}

/** Grava o conteúdo completo de uma versão (substitui unidades e habilidades). */
async function writeContent(tx: Tx, versionId: number, units: PlanUnitInput[]) {
  const { units: normalized, errors } = normalizePlanUnits(units)
  if (errors.length) throw new PlanningError('Corrija o planejamento antes de salvar.', 422, errors)
  const missing = normalized.flatMap((unit) => unit.skills.filter((skill) => !skill.description))
  const enriched = missing.length ? new Map((await enrichBnccDescriptions(missing)).map((skill) => [skill.code, skill.description])) : new Map()
  await tx.delete(curriculumPlanUnits).where(eq(curriculumPlanUnits.versionId, versionId))
  for (const [position, unit] of normalized.entries()) {
    const [saved] = await tx.insert(curriculumPlanUnits).values({ versionId, position, title: unit.title, content: unit.content, objectives: unit.objectives }).returning()
    if (unit.skills.length) await tx.insert(curriculumPlanSkills).values(unit.skills.map((skill, skillPosition) => ({ unitId: saved.id, code: skill.code, description: skill.description ?? enriched.get(skill.code) ?? null, position: skillPosition, targetMasteryPercent: skill.targetMasteryPercent })))
  }
  await tx.update(curriculumPlanVersions).set({ updatedAt: new Date() }).where(eq(curriculumPlanVersions.id, versionId))
  return { unitCount: normalized.length, skillCount: normalized.reduce((sum, unit) => sum + unit.skills.length, 0) }
}

async function nextVersionNumber(planId: number, tx: Tx) {
  const [last] = await tx.select({ versionNumber: curriculumPlanVersions.versionNumber }).from(curriculumPlanVersions).where(eq(curriculumPlanVersions.planId, planId)).orderBy(desc(curriculumPlanVersions.versionNumber)).limit(1)
  return (last?.versionNumber ?? 0) + 1
}

// ── Leitura ─────────────────────────────────────────────────────────

export async function listPlans(viewer: Viewer, filters: Partial<Omit<PlanScope, 'bimester'>> & { bimester?: number }) {
  const conditions: SQL[] = []
  if (filters.academicYear) conditions.push(eq(curriculumPlans.academicYear, filters.academicYear))
  if (filters.segment) conditions.push(eq(curriculumPlans.segment, filters.segment))
  if (filters.gradeYear) conditions.push(eq(curriculumPlans.gradeYear, filters.gradeYear))
  if (filters.subject) conditions.push(eq(curriculumPlans.subject, filters.subject))
  if (filters.bimester) conditions.push(eq(curriculumPlans.bimester, filters.bimester))
  if (!isStaffSuperuser(viewer.role)) {
    const mine = await db.select({ planId: curriculumPlanAssignments.planId }).from(curriculumPlanAssignments).where(eq(curriculumPlanAssignments.userId, viewer.id))
    if (!mine.length) return []
    conditions.push(inArray(curriculumPlans.id, mine.map((row) => row.planId)))
  }
  const plans = await db.select().from(curriculumPlans).where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(curriculumPlans.academicYear), asc(curriculumPlans.segment), asc(curriculumPlans.gradeYear), asc(curriculumPlans.subject), asc(curriculumPlans.bimester))
  if (!plans.length) return []
  const ids = plans.map((plan) => plan.id)
  const versions = await db.select({ id: curriculumPlanVersions.id, planId: curriculumPlanVersions.planId, versionNumber: curriculumPlanVersions.versionNumber, status: curriculumPlanVersions.status, updatedAt: curriculumPlanVersions.updatedAt })
    .from(curriculumPlanVersions).where(inArray(curriculumPlanVersions.planId, ids))
  const assignments = await db.select({ planId: curriculumPlanAssignments.planId, userId: users.id, name: users.name, responsibility: curriculumPlanAssignments.responsibility })
    .from(curriculumPlanAssignments).innerJoin(users, eq(users.id, curriculumPlanAssignments.userId)).where(inArray(curriculumPlanAssignments.planId, ids))
  return plans.map((plan) => {
    const planVersions = versions.filter((version) => version.planId === plan.id)
    const official = officialVersion(planVersions)
    const open = openVersion(planVersions)
    return {
      ...plan,
      official: official && { id: official.id, versionNumber: official.versionNumber, status: official.status },
      open: open && { id: open.id, versionNumber: open.versionNumber, status: open.status },
      versionCount: planVersions.length,
      lastUpdate: planVersions.reduce<Date | null>((latest, version) => !latest || version.updatedAt > latest ? version.updatedAt : latest, null),
      assignments: assignments.filter((assignment) => assignment.planId === plan.id).map(({ planId: _planId, ...rest }) => rest),
    }
  })
}

export async function getPlanDetail(viewer: Viewer, planId: number, versionId?: number) {
  const [plan] = await db.select().from(curriculumPlans).where(eq(curriculumPlans.id, planId))
  if (!plan) throw new PlanningError('Planejamento não encontrado.', 404)
  const context = await accessContext(viewer, planId)
  if (!canViewPlan(context)) throw new PlanningError('Sem acesso a este planejamento.', 403)
  const versions = await versionsOf(planId)
  const selected = (versionId ? versions.find((version) => version.id === versionId) : null) ?? openVersion(versions) ?? officialVersion(versions) ?? versions.at(-1) ?? null
  const units = selected ? await versionContent(selected.id) : []
  const assignments = await db.select({ userId: users.id, name: users.name, email: users.email, responsibility: curriculumPlanAssignments.responsibility })
    .from(curriculumPlanAssignments).innerJoin(users, eq(users.id, curriculumPlanAssignments.userId)).where(eq(curriculumPlanAssignments.planId, planId))
  const history = versions.length ? await db.select({ id: curriculumPlanStatusHistory.id, versionId: curriculumPlanStatusHistory.versionId, fromStatus: curriculumPlanStatusHistory.fromStatus, toStatus: curriculumPlanStatusHistory.toStatus, note: curriculumPlanStatusHistory.note, createdAt: curriculumPlanStatusHistory.createdAt, changedBy: users.name })
    .from(curriculumPlanStatusHistory).innerJoin(users, eq(users.id, curriculumPlanStatusHistory.changedBy))
    .where(inArray(curriculumPlanStatusHistory.versionId, versions.map((version) => version.id))).orderBy(desc(curriculumPlanStatusHistory.createdAt)) : []
  const official = officialVersion(versions)
  return {
    plan,
    versions: versions.map((version) => ({ id: version.id, versionNumber: version.versionNumber, status: version.status, source: version.source, sourceReference: version.sourceReference, copiedFromVersionId: version.copiedFromVersionId, createdAt: version.createdAt, updatedAt: version.updatedAt, approvedAt: version.approvedAt, closedAt: version.closedAt })),
    selectedVersionId: selected?.id ?? null,
    officialVersionId: official?.id ?? null,
    units,
    assignments,
    history,
    permissions: {
      edit: !!selected && canEditPlan(context, selected.status),
      manage: isStaffSuperuser(viewer.role),
      startNewVersion: canStartNewVersion(context, versions, 'justificativa'),
      transitions: selected ? (['rascunho', 'em_revisao', 'aprovado', 'encerrado'] as PlanningStatus[]).filter((to) => canTransitionPlan(context, selected.status, to)) : [],
    },
  }
}

// ── Escrita ─────────────────────────────────────────────────────────

export async function createPlan(viewer: Viewer, scope: PlanScope) {
  requireManager(viewer)
  const invalid = validatePlanScope(scope)
  if (invalid) throw new PlanningError(invalid)
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: curriculumPlans.id }).from(curriculumPlans).where(and(eq(curriculumPlans.academicYear, scope.academicYear), eq(curriculumPlans.segment, scope.segment), eq(curriculumPlans.gradeYear, scope.gradeYear), eq(curriculumPlans.subject, scope.subject), eq(curriculumPlans.bimester, scope.bimester)))
    if (existing) throw new PlanningError('Já existe planejamento para este recorte.', 409)
    const [plan] = await tx.insert(curriculumPlans).values({ ...scope, createdBy: viewer.id }).returning()
    const [version] = await tx.insert(curriculumPlanVersions).values({ planId: plan.id, versionNumber: 1, status: 'rascunho', source: 'interno', createdBy: viewer.id }).returning()
    await tx.insert(curriculumPlanStatusHistory).values({ versionId: version.id, fromStatus: null, toStatus: 'rascunho', changedBy: viewer.id, note: 'Criado do zero na Prova TRI' })
    await recordDecision(tx, { entityType: 'plano', entityId: plan.id, planId: plan.id, action: 'criado', summary: 'Planejamento criado do zero', actorId: viewer.id })
    return { planId: plan.id, versionId: version.id }
  })
}

/** Alteração de planejamento aprovado/encerrado: nova versão em rascunho com o conteúdo oficial. */
export async function startNewVersion(viewer: Viewer, planId: number, note?: string | null) {
  return db.transaction(async (tx) => {
    const context = await accessContext(viewer, planId, tx)
    const versions = await versionsOf(planId, tx)
    const allowed = canStartNewVersion(context, versions, note)
    if (!allowed.ok) throw new PlanningError(allowed.reason, 409)
    const base = officialVersion(versions)
    const [version] = await tx.insert(curriculumPlanVersions).values({ planId, versionNumber: await nextVersionNumber(planId, tx), status: 'rascunho', source: 'interno', copiedFromVersionId: base?.id ?? null, createdBy: viewer.id }).returning()
    if (base) await writeContent(tx, version.id, await versionContent(base.id, tx))
    await tx.insert(curriculumPlanStatusHistory).values({ versionId: version.id, fromStatus: null, toStatus: 'rascunho', changedBy: viewer.id, note: note?.trim() || (base ? `Nova versão a partir da versão ${base.versionNumber}` : 'Nova versão') })
    await recordDecision(tx, { entityType: 'versao', entityId: version.id, planId, action: 'nova_versao', summary: `Versão ${version.versionNumber} aberta${base ? ` a partir da versão ${base.versionNumber}` : ''}`, details: { note: note?.trim() || null, baseVersionId: base?.id ?? null, baseStatus: base?.status ?? null }, actorId: viewer.id })
    return { versionId: version.id, versionNumber: version.versionNumber }
  })
}

export async function saveDraft(viewer: Viewer, versionId: number, units: PlanUnitInput[]) {
  return db.transaction(async (tx) => {
    const [version] = await tx.select().from(curriculumPlanVersions).where(eq(curriculumPlanVersions.id, versionId))
    if (!version) throw new PlanningError('Versão não encontrada.', 404)
    const context = await accessContext(viewer, version.planId, tx)
    if (!canEditPlan(context, version.status)) {
      throw new PlanningError(version.status === 'rascunho' ? 'Sem permissão para editar este planejamento.' : 'Esta versão não pode ser editada diretamente. Abra uma nova versão para propor alterações.', 403)
    }
    const before = (await versionContent(versionId, tx)).flatMap((unit) => unit.skills.map((skill) => skill.code))
    const result = await writeContent(tx, versionId, units)
    const after = (await versionContent(versionId, tx)).flatMap((unit) => unit.skills.map((skill) => skill.code))
    const diff = skillDiff(before, after)
    const parts = [`${result.unitCount} unidade(s), ${result.skillCount} habilidade(s)`]
    if (diff.added.length) parts.push(`+${diff.added.join(', ')}`)
    if (diff.removed.length) parts.push(`−${diff.removed.join(', ')}`)
    await recordDecision(tx, { entityType: 'versao', entityId: versionId, planId: version.planId, action: 'conteudo_salvo', summary: `Versão ${version.versionNumber} editada: ${parts.join(' · ')}`, details: diff, actorId: viewer.id })
    return result
  })
}

export async function transitionVersion(viewer: Viewer, versionId: number, to: PlanningStatus, note?: string | null) {
  return db.transaction(async (tx) => {
    const [version] = await tx.select().from(curriculumPlanVersions).where(eq(curriculumPlanVersions.id, versionId))
    if (!version) throw new PlanningError('Versão não encontrada.', 404)
    const context = await accessContext(viewer, version.planId, tx)
    if (!canTransitionPlan(context, version.status, to)) throw new PlanningError('Transição não permitida para o seu perfil neste momento.', 403)
    if (to === 'em_revisao') {
      const units = await versionContent(versionId, tx)
      if (!units.length) throw new PlanningError('Adicione ao menos uma unidade antes de enviar para revisão.', 422)
    }
    if (version.status === 'em_revisao' && to === 'rascunho' && !note?.trim()) throw new PlanningError('Explique o que precisa ser ajustado ao devolver para o professor.', 422)
    const now = new Date()
    const patch: Partial<typeof curriculumPlanVersions.$inferInsert> = { status: to, updatedAt: now }
    if (to === 'em_revisao') patch.submittedAt = now
    if (version.status === 'em_revisao') patch.reviewedBy = viewer.id
    if (to === 'aprovado') { patch.approvedBy = viewer.id; patch.approvedAt = now }
    if (to === 'encerrado') patch.closedAt = now
    await tx.update(curriculumPlanVersions).set(patch).where(eq(curriculumPlanVersions.id, versionId))
    await tx.insert(curriculumPlanStatusHistory).values({ versionId, fromStatus: version.status, toStatus: to, changedBy: viewer.id, note: note?.trim() || null })
    await recordDecision(tx, { entityType: 'versao', entityId: versionId, planId: version.planId, action: `status_${to}`, summary: `Versão ${version.versionNumber}: ${version.status} → ${to}${note?.trim() ? ` (${note.trim()})` : ''}`, details: { from: version.status, to, note: note?.trim() || null }, actorId: viewer.id })
    // Ao aprovar uma nova versão, a anterior ainda "aprovada" deixa de valer:
    // o encerramento do bimestre passa a considerar só a versão oficial.
    return { versionId, status: to }
  })
}

export async function setAssignment(viewer: Viewer, planId: number, userId: number, responsibility: 'responsavel' | 'colaborador' | null) {
  requireManager(viewer)
  if (responsibility === null) {
    await db.delete(curriculumPlanAssignments).where(and(eq(curriculumPlanAssignments.planId, planId), eq(curriculumPlanAssignments.userId, userId)))
    const [removedUser] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId))
    await recordDecision(db, { entityType: 'plano', entityId: planId, planId, action: 'responsavel_removido', summary: `${removedUser?.name ?? `Usuário ${userId}`} deixou de ser responsável`, details: { userId }, actorId: viewer.id })
    return { removed: true }
  }
  const [user] = await db.select({ id: users.id, active: users.active, name: users.name }).from(users).where(eq(users.id, userId))
  if (!user?.active) throw new PlanningError('Usuário inexistente ou inativo.', 404)
  await db.insert(curriculumPlanAssignments).values({ planId, userId, responsibility, assignedBy: viewer.id })
    .onConflictDoUpdate({ target: [curriculumPlanAssignments.planId, curriculumPlanAssignments.userId], set: { responsibility, assignedBy: viewer.id, assignedAt: new Date() } })
  await recordDecision(db, { entityType: 'plano', entityId: planId, planId, action: 'responsavel_atribuido', summary: `${user.name} atribuído(a) como ${responsibility}`, details: { userId, responsibility }, actorId: viewer.id })
  return { removed: false }
}

/** Copia a versão oficial de cada planejamento de um ano para rascunhos do ano seguinte, com os mesmos responsáveis. */
export async function copyYear(viewer: Viewer, fromYear: number, toYear: number, filters: { segment?: PlanScope['segment']; gradeYear?: number; subject?: string } = {}) {
  requireManager(viewer)
  if (!Number.isInteger(fromYear) || !Number.isInteger(toYear) || toYear <= fromYear) throw new PlanningError('O ano de destino deve ser posterior ao de origem.')
  const conditions: SQL[] = [eq(curriculumPlans.academicYear, fromYear)]
  if (filters.segment) conditions.push(eq(curriculumPlans.segment, filters.segment))
  if (filters.gradeYear) conditions.push(eq(curriculumPlans.gradeYear, filters.gradeYear))
  if (filters.subject) conditions.push(eq(curriculumPlans.subject, filters.subject))
  const sources = await db.select().from(curriculumPlans).where(and(...conditions))
  const created: string[] = []
  const skipped: string[] = []
  for (const source of sources) {
    const label = `${source.subject} ${source.gradeYear}º ano, ${source.bimester}º bim.`
    const official = officialVersion(await versionsOf(source.id))
    if (!official) { skipped.push(`${label}: sem versão aprovada em ${fromYear}`); continue }
    await db.transaction(async (tx) => {
      const [target] = await tx.insert(curriculumPlans).values({ academicYear: toYear, segment: source.segment, gradeYear: source.gradeYear, subject: source.subject, bimester: source.bimester, createdBy: viewer.id })
        .onConflictDoUpdate({ target: [curriculumPlans.academicYear, curriculumPlans.segment, curriculumPlans.gradeYear, curriculumPlans.subject, curriculumPlans.bimester], set: { updatedAt: new Date() } }).returning()
      const targetVersions = await versionsOf(target.id, tx)
      if (targetVersions.length) { skipped.push(`${label}: ${toYear} já tem planejamento`); return }
      const [version] = await tx.insert(curriculumPlanVersions).values({ planId: target.id, versionNumber: 1, status: 'rascunho', source: 'copia', sourceReference: `${fromYear} v${official.versionNumber}`, copiedFromVersionId: official.id, createdBy: viewer.id }).returning()
      await writeContent(tx, version.id, await versionContent(official.id, tx))
      const people = await tx.select().from(curriculumPlanAssignments).where(eq(curriculumPlanAssignments.planId, source.id))
      if (people.length) await tx.insert(curriculumPlanAssignments).values(people.map((person) => ({ planId: target.id, userId: person.userId, responsibility: person.responsibility, assignedBy: viewer.id }))).onConflictDoNothing()
      await tx.insert(curriculumPlanStatusHistory).values({ versionId: version.id, fromStatus: null, toStatus: 'rascunho', changedBy: viewer.id, note: `Copiado de ${fromYear} (versão ${official.versionNumber})` })
      await recordDecision(tx, { entityType: 'plano', entityId: target.id, planId: target.id, action: 'copiado_de_ano', summary: `Copiado de ${fromYear} (versão ${official.versionNumber})`, details: { sourcePlanId: source.id, sourceVersionId: official.id }, actorId: viewer.id })
      created.push(label)
    })
  }
  return { created, skipped }
}

/** Encerra o bimestre: a versão oficial de cada planejamento do recorte passa a "encerrado". */
export async function closeBimester(viewer: Viewer, academicYear: number, bimester: number, filters: { segment?: PlanScope['segment']; gradeYear?: number; subject?: string } = {}) {
  requireManager(viewer)
  const conditions: SQL[] = [eq(curriculumPlans.academicYear, academicYear), eq(curriculumPlans.bimester, bimester)]
  if (filters.segment) conditions.push(eq(curriculumPlans.segment, filters.segment))
  if (filters.gradeYear) conditions.push(eq(curriculumPlans.gradeYear, filters.gradeYear))
  if (filters.subject) conditions.push(eq(curriculumPlans.subject, filters.subject))
  const plans = await db.select().from(curriculumPlans).where(and(...conditions))
  const closed: string[] = []
  const pending: string[] = []
  for (const plan of plans) {
    const label = `${plan.subject} ${plan.gradeYear}º ano`
    const versions = await versionsOf(plan.id)
    const official = officialVersion(versions)
    if (openVersion(versions)) { pending.push(`${label}: há versão em rascunho ou revisão`); continue }
    if (!official) { pending.push(`${label}: nunca foi aprovado`); continue }
    if (official.status === 'encerrado') continue
    await transitionVersion(viewer, official.id, 'encerrado', `Encerramento do ${bimester}º bimestre de ${academicYear}`)
    closed.push(label)
  }
  return { closed, pending }
}

// ── Exportação ──────────────────────────────────────────────────────

function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV com ";" e BOM UTF-8: abre direto no Excel em português e no Google Sheets. */
export async function exportPlanCsv(viewer: Viewer, planId: number, versionId?: number) {
  const detail = await getPlanDetail(viewer, planId, versionId)
  const version = detail.versions.find((item) => item.id === detail.selectedVersionId)
  const header = ['Ano letivo', 'Segmento', 'Série', 'Disciplina', 'Bimestre', 'Versão', 'Situação', 'Unidade', 'Título', 'Conteúdos', 'Objetivos', 'Código BNCC', 'Habilidade', 'Meta de domínio (%)']
  const lines = [header.join(';')]
  const base = [detail.plan.academicYear, detail.plan.segment, `${detail.plan.gradeYear}º ano`, detail.plan.subject, `${detail.plan.bimester}º`, version?.versionNumber ?? '', version?.status ?? '']
  detail.units.forEach((unit, index) => {
    const rows = unit.skills.length ? unit.skills : [{ code: '', description: '', targetMasteryPercent: null as number | null }]
    for (const skill of rows) lines.push([...base, index + 1, unit.title, unit.content, unit.objectives, skill.code, skill.description, skill.targetMasteryPercent].map(csvCell).join(';'))
  })
  const filename = `planejamento-${detail.plan.academicYear}-${detail.plan.subject}-${detail.plan.gradeYear}ano-${detail.plan.bimester}bim-v${version?.versionNumber ?? 0}`
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase()
  return { filename: `${filename}.csv`, body: `﻿${lines.join('\r\n')}\r\n` }
}
