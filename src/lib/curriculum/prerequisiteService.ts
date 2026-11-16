// Pré-requisitos curriculares: catálogo, sugestão por IA, revisão e leitura.
// Escrever (sugerir, aprovar, rejeitar, cadastrar) é só de coordenação/direção.
// Ler é de qualquer usuário autenticado: o mapa é institucional, não de aluno.

import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { db } from '@/db/client'
import { curriculumPlans, curriculumSkillPrerequisites, users } from '@/db/schema'
import { isStaffSuperuser } from '@/lib/auth/roles'
import { enrichBnccDescriptions } from './bnccDescriptions'
import { canonicalSubject, loadPlannedSkills } from './masteryData'
import { buildSuggestionGroups, levelOf, STRENGTH_WEIGHT, suggestPrerequisitesForGroups, type CatalogSkill, type PrerequisiteGenerator, type PrerequisiteStrength } from './prerequisiteSuggestions'

export type PrerequisiteViewer = { id: number; role: string }
export type PrerequisiteStatus = (typeof curriculumSkillPrerequisites.$inferSelect)['status']

export class PrerequisiteError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

function requireManager(viewer: PrerequisiteViewer) {
  if (!isStaffSuperuser(viewer.role)) throw new PrerequisiteError('Só a coordenação ou a direção pode alterar pré-requisitos.', 403)
}

/**
 * Habilidades planejadas da disciplina em todas as séries, pela versão oficial
 * de cada planejamento. De cada série vale o ano letivo mais recente.
 */
export async function loadSkillCatalog(subject: string): Promise<CatalogSkill[]> {
  const years = (await db.selectDistinct({ year: curriculumPlans.academicYear }).from(curriculumPlans)).map((row) => row.year)
  const key = canonicalSubject(subject)
  const planned = await loadPlannedSkills(years, (plan) => (canonicalSubject(plan.subject) === key ? plan : null))
  const latestYear = new Map<string, number>()
  for (const skill of planned) {
    const grade = `${skill.segment}:${skill.gradeYear}`
    latestYear.set(grade, Math.max(latestYear.get(grade) ?? 0, skill.academicYear))
  }
  const firstByCode = new Map<string, CatalogSkill>()
  for (const skill of planned) {
    if (skill.academicYear !== latestYear.get(`${skill.segment}:${skill.gradeYear}`)) continue
    const code = skill.code.trim().toUpperCase()
    const id = `${skill.segment}:${skill.gradeYear}:${code}`
    const current = firstByCode.get(id)
    if (!current || skill.bimester < current.bimester) firstByCode.set(id, { code, description: skill.description ?? current?.description ?? null, segment: skill.segment, gradeYear: skill.gradeYear, subject: skill.subject, bimester: skill.bimester })
  }
  return enrichBnccDescriptions([...firstByCode.values()])
}

/** Séries e disciplinas que têm planejamento, para os filtros da tela. */
export async function listPlanningOptions() {
  const rows = await db.selectDistinct({ segment: curriculumPlans.segment, gradeYear: curriculumPlans.gradeYear, subject: curriculumPlans.subject }).from(curriculumPlans)
  const unique = new Map<string, { segment: string; gradeYear: number; subject: string }>()
  for (const row of rows) unique.set(`${row.segment}:${row.gradeYear}:${canonicalSubject(row.subject)}`, row)
  return [...unique.values()].sort((a, b) => levelOf(a.segment, a.gradeYear) - levelOf(b.segment, b.gradeYear) || a.subject.localeCompare(b.subject, 'pt-BR'))
}

export type SuggestResult = { created: number; alreadyMapped: number; discarded: number; targets: number; aiCalls: number }

/**
 * Pede à IA os pré-requisitos das habilidades de uma série. Por padrão pula as
 * habilidades que já têm algum par registrado (sugerido, aprovado ou rejeitado),
 * para não gastar IA nem desfazer decisão da coordenação.
 */
export async function suggestPrerequisites(params: { viewer: PrerequisiteViewer; segment: string; gradeYear: number; subject: string; onlyMissing?: boolean; generate: PrerequisiteGenerator }): Promise<SuggestResult> {
  requireManager(params.viewer)
  const catalog = await loadSkillCatalog(params.subject)
  const groups = buildSuggestionGroups(catalog, params)
  const targetCodes = groups.flatMap((group) => group.targets.map((skill) => skill.code))
  let mapped = new Set<string>()
  if (params.onlyMissing !== false && targetCodes.length) {
    const rows = await db.selectDistinct({ code: curriculumSkillPrerequisites.skillCode }).from(curriculumSkillPrerequisites).where(inArray(curriculumSkillPrerequisites.skillCode, targetCodes))
    mapped = new Set(rows.map((row) => row.code))
  }
  const pending = groups.map((group) => ({ ...group, targets: group.targets.filter((skill) => !mapped.has(skill.code)) })).filter((group) => group.targets.length)
  const targets = pending.reduce((total, group) => total + group.targets.length, 0)
  if (!targets) return { created: 0, alreadyMapped: mapped.size, discarded: 0, targets: 0, aiCalls: 0 }

  const result = await suggestPrerequisitesForGroups(params.subject, pending, params.generate)
  let created = 0
  if (result.suggestions.length) {
    const inserted = await db.insert(curriculumSkillPrerequisites).values(result.suggestions.map((item) => ({
      subject: params.subject,
      prerequisiteCode: item.prerequisite.code, prerequisiteSegment: item.prerequisite.segment, prerequisiteGradeYear: item.prerequisite.gradeYear,
      skillCode: item.skill.code, skillSegment: item.skill.segment, skillGradeYear: item.skill.gradeYear,
      status: 'sugerida' as const, source: 'ia' as const, strength: item.strength, rationale: item.rationale, suggestedBy: params.viewer.id,
    }))).onConflictDoNothing().returning({ id: curriculumSkillPrerequisites.id })
    created = inserted.length
  }
  return { created, alreadyMapped: mapped.size, discarded: result.discardedCount + result.suggestions.length - created, targets, aiCalls: result.callCount }
}

export async function listPrerequisites(filters: { subject?: string; segment?: string; gradeYear?: number; status?: PrerequisiteStatus }) {
  const conditions: SQL[] = []
  if (filters.segment) conditions.push(eq(curriculumSkillPrerequisites.skillSegment, filters.segment))
  if (filters.gradeYear) conditions.push(eq(curriculumSkillPrerequisites.skillGradeYear, filters.gradeYear))
  if (filters.status) conditions.push(eq(curriculumSkillPrerequisites.status, filters.status))
  const rows = await db.select({
    row: curriculumSkillPrerequisites,
    reviewerName: users.name,
  }).from(curriculumSkillPrerequisites)
    .leftJoin(users, eq(users.id, curriculumSkillPrerequisites.reviewedBy))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(curriculumSkillPrerequisites.skillCode), asc(curriculumSkillPrerequisites.prerequisiteCode))
  const key = filters.subject ? canonicalSubject(filters.subject) : null
  return rows.filter(({ row }) => !key || canonicalSubject(row.subject) === key).map(({ row, reviewerName }) => ({ ...row, reviewerName }))
}

export async function reviewPrerequisite(params: { viewer: PrerequisiteViewer; id: number; status: 'aprovada' | 'rejeitada'; strength?: PrerequisiteStrength; note?: string | null }) {
  requireManager(params.viewer)
  const [updated] = await db.update(curriculumSkillPrerequisites).set({
    status: params.status,
    ...(params.strength ? { strength: params.strength } : {}),
    reviewNote: params.note?.trim() || null,
    reviewedBy: params.viewer.id,
    reviewedAt: new Date(),
  }).where(eq(curriculumSkillPrerequisites.id, params.id)).returning()
  if (!updated) throw new PrerequisiteError('Pré-requisito não encontrado.', 404)
  return updated
}

/** Cadastro direto pela coordenação: já nasce aprovado. Os dois códigos precisam estar no planejamento. */
export async function createManualPrerequisite(params: { viewer: PrerequisiteViewer; subject: string; prerequisiteCode: string; skillCode: string; strength: PrerequisiteStrength; rationale: string }) {
  requireManager(params.viewer)
  const prerequisiteCode = params.prerequisiteCode.trim().toUpperCase()
  const skillCode = params.skillCode.trim().toUpperCase()
  if (prerequisiteCode === skillCode) throw new PrerequisiteError('Uma habilidade não pode ser pré-requisito de si mesma.', 400)
  const catalog = await loadSkillCatalog(params.subject)
  const base = catalog.find((skill) => skill.code === prerequisiteCode)
  const target = catalog.find((skill) => skill.code === skillCode)
  if (!base || !target) throw new PrerequisiteError('Os dois códigos precisam estar no planejamento desta disciplina.', 400)
  if (levelOf(base.segment, base.gradeYear) > levelOf(target.segment, target.gradeYear)) throw new PrerequisiteError('O pré-requisito precisa ser de série igual ou anterior à habilidade.', 400)
  const values = {
    subject: params.subject, prerequisiteCode, prerequisiteSegment: base.segment, prerequisiteGradeYear: base.gradeYear,
    skillCode, skillSegment: target.segment, skillGradeYear: target.gradeYear,
    status: 'aprovada' as const, source: 'coordenacao' as const, strength: params.strength, rationale: params.rationale.trim(),
    suggestedBy: params.viewer.id, reviewedBy: params.viewer.id, reviewedAt: new Date(),
  }
  // Par já existente (inclusive rejeitado) vira a decisão da coordenação.
  const [row] = await db.insert(curriculumSkillPrerequisites).values(values)
    .onConflictDoUpdate({ target: [curriculumSkillPrerequisites.prerequisiteCode, curriculumSkillPrerequisites.skillCode], set: { status: 'aprovada', strength: values.strength, rationale: values.rationale, reviewedBy: values.reviewedBy, reviewedAt: values.reviewedAt, reviewNote: sql`null` } })
    .returning()
  return row
}

/** Pré-requisitos aprovados que chegam a alguma das habilidades informadas, com o peso da força. */
export async function approvedPrerequisitesFor(skillCodes: string[]) {
  const codes = [...new Set(skillCodes.map((code) => code.trim().toUpperCase()))]
  if (!codes.length) return []
  const rows = await db.select({
    prerequisiteCode: curriculumSkillPrerequisites.prerequisiteCode,
    skillCode: curriculumSkillPrerequisites.skillCode,
    strength: curriculumSkillPrerequisites.strength,
  }).from(curriculumSkillPrerequisites).where(and(eq(curriculumSkillPrerequisites.status, 'aprovada'), inArray(curriculumSkillPrerequisites.skillCode, codes)))
  return rows.map((row) => ({ ...row, weight: STRENGTH_WEIGHT[row.strength] }))
}
