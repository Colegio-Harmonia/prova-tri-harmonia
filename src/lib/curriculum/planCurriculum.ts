import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { curriculumPlanSkills, curriculumPlanUnits, curriculumPlanVersions, curriculumPlans, enemAreas, enemCompetencies, enemSkills } from '@/db/schema'
import { parseObjetivos } from '@/lib/sheets/objetivosParser'
import { parseEnemSkills } from '@/lib/sheets/enemSkillsParser'
import { getEnemAreaForSubject } from '@/config/enemAreaMap'
import { isEnemAreaCode } from '@/config/enemMatrix'
import type { CurricularUnit, CurriculumSelection, Segment } from '@/types/exam'

export class CurriculumPlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CurriculumPlanError'
  }
}

export type CurriculumScope = { segment: Segment; gradeYear: number; subject: string; bimester?: number; academicYear?: number; curriculumPlanVersionId?: number }

export type PlanUnitRow = {
  position: number
  title: string
  content: string | null
  objectives: string | null
  /** Ensino Médio: habilidades ENEM "C2:H5 (origem)", uma por linha. */
  enemSkills?: string | null
  skills: Array<{ code: string; description: string | null }>
}

/** O planejamento só chega à prova depois de aprovado; versão em rascunho nunca gera avaliação. */
export const PLAN_VERSION_STATUS_FOR_GENERATION = 'aprovado'

/** Lê o id do planejamento gravado na prova no momento da geração (se houve). */
export function planIdFromExamPayload(payload: unknown): number | undefined {
  const id = (payload as { metadata?: { curriculumPlanId?: unknown } } | null | undefined)?.metadata?.curriculumPlanId
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : undefined
}

export function planVersionIdFromExamPayload(payload: unknown): number | undefined {
  const id = (payload as { metadata?: { curriculumPlanVersionId?: unknown } } | null)?.metadata?.curriculumPlanVersionId
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : undefined
}

/**
 * Traduz as unidades do planejamento interno para o mesmo contrato que a
 * planilha produz, para o resto da geração não saber de onde veio o currículo.
 * `rowIndex` é a posição da unidade no planejamento (0, 1, 2...).
 */
export function buildCurriculumFromPlan(
  scope: CurriculumScope,
  tabName: string,
  rows: PlanUnitRow[],
): CurriculumSelection {
  const enemAreaRaw = getEnemAreaForSubject(scope.subject)
  const enemArea = isEnemAreaCode(enemAreaRaw) ? enemAreaRaw : null
  const units: CurricularUnit[] = [...rows]
    .sort((a, b) => a.position - b.position)
    .map((row) => {
      const objectives = row.objectives?.trim() || null
      const hasSkills = row.skills.length > 0
      return {
        rowIndex: row.position,
        bimestre: scope.bimester !== undefined ? String(scope.bimester) : null,
        tituloCapitulo: row.title,
        conteudo: row.content,
        habilidades: hasSkills
          ? { status: 'mapeado', skills: row.skills.map((skill) => ({ code: skill.code, description: skill.description })) }
          : { status: 'nao_mapeado', skills: [], reason: 'planejamento sem habilidades BNCC nesta unidade' },
        objetivos: parseObjetivos(objectives),
        objetivosColumnMissing: !objectives,
        // A geração monta o prompt com título + conteúdo + conteúdo enriquecido;
        // os objetivos do planejamento entram por aqui para chegarem à IA.
        enrichedContent: objectives ? `Objetivos de aprendizagem do planejamento:\n${objectives}` : null,
        enrichedObjectives: objectives,
        ...(scope.segment === 'ensino-medio' && row.enemSkills?.trim()
          ? { enemSkills: parseEnemSkills(row.enemSkills, enemArea), enemSkillsRaw: row.enemSkills.trim() }
          : {}),
      }
    })

  const unmappedWarnings = [
    ...units
      .filter((unit) => unit.enemSkills?.invalid.length)
      .map((unit) => `"${unit.tituloCapitulo}": código(s) ENEM inexistente(s) na matriz da área, ignorado(s): ${unit.enemSkills!.invalid.join(', ')}.`),
    // No EM planejado pela Matriz do ENEM, faltar BNCC não é lacuna do planejamento.
    ...units
      .filter((unit) => unit.habilidades.status === 'nao_mapeado' && !unit.enemSkills?.skills.length)
      .map((unit) => `"${unit.tituloCapitulo}": habilidade BNCC não mapeada (${unit.habilidades.reason}).`),
  ]

  return { segment: scope.segment, gradeYear: scope.gradeYear, subject: scope.subject, bimester: scope.bimester, tabName, units, unmappedWarnings }
}

/**
 * Currículo a partir da versão aprovada mais recente do planejamento. Falha se o
 * planejamento não existir, não estiver aprovado ou for de outro recorte que a
 * prova (série, disciplina e bimestre precisam coincidir).
 */
export async function getCurriculumFromPlan(planId: number, scope: CurriculumScope): Promise<CurriculumSelection> {
  const plan = await db.query.curriculumPlans.findFirst({ where: eq(curriculumPlans.id, planId) })
  if (!plan) throw new CurriculumPlanError(`Planejamento #${planId} não encontrado.`)
  if (plan.segment !== scope.segment || plan.gradeYear !== scope.gradeYear || plan.subject !== scope.subject || (scope.bimester !== undefined && plan.bimester !== scope.bimester) || (scope.academicYear !== undefined && plan.academicYear !== scope.academicYear)) {
    throw new CurriculumPlanError(`O planejamento #${planId} não corresponde ao ano letivo, segmento, série, disciplina e bimestre da prova.`)
  }

  const version = await db.query.curriculumPlanVersions.findFirst({
    where: and(eq(curriculumPlanVersions.planId, planId), scope.curriculumPlanVersionId ? inArray(curriculumPlanVersions.status, ['aprovado', 'encerrado']) : eq(curriculumPlanVersions.status, PLAN_VERSION_STATUS_FOR_GENERATION), scope.curriculumPlanVersionId ? eq(curriculumPlanVersions.id, scope.curriculumPlanVersionId) : undefined),
    orderBy: [desc(curriculumPlanVersions.versionNumber)],
  })
  if (!version) throw new CurriculumPlanError(`O planejamento #${planId} não tem versão aprovada; aprove-o antes de gerar uma prova.`)

  const units = await db.select().from(curriculumPlanUnits).where(eq(curriculumPlanUnits.versionId, version.id)).orderBy(asc(curriculumPlanUnits.position))
  if (!units.length) throw new CurriculumPlanError(`A versão ${version.versionNumber} do planejamento #${planId} não tem unidades.`)

  const skills = await db
    .select()
    .from(curriculumPlanSkills)
    .where(inArray(curriculumPlanSkills.unitId, units.map((unit) => unit.id)))
    .orderBy(asc(curriculumPlanSkills.position))
  const skillsByUnit = new Map<number, PlanUnitRow['skills']>()
  for (const skill of skills) {
    const list = skillsByUnit.get(skill.unitId) ?? []
    list.push({ code: skill.code, description: skill.description })
    skillsByUnit.set(skill.unitId, list)
  }

  const selection = buildCurriculumFromPlan(
    { ...scope, bimester: scope.bimester ?? plan.bimester },
    `Planejamento interno #${planId} (versão ${version.versionNumber})`,
    units.map((unit) => ({ position: unit.position, title: unit.title, content: unit.content, objectives: unit.objectives, enemSkills: unit.enemSkills, skills: skillsByUnit.get(unit.id) ?? [] })),
  )
  selection.planReference = { planId, versionId: version.id, versionNumber: version.versionNumber }
  // Áreas fora de Linguagens também precisam do texto da habilidade no prompt.
  if (selection.units.some((unit) => unit.enemSkills?.skills.some((skill) => !skill.description))) {
    const rows = await db.select({ code: enemSkills.code, description: enemSkills.description, competency: enemCompetencies.number })
      .from(enemSkills).innerJoin(enemCompetencies, eq(enemCompetencies.id, enemSkills.competencyId))
      .innerJoin(enemAreas, eq(enemAreas.id, enemCompetencies.areaId))
      .where(eq(enemAreas.code, getEnemAreaForSubject(scope.subject) ?? ''))
    const descriptions = new Map(rows.map((row) => [`C${row.competency}:${row.code}`, row.description]))
    for (const unit of selection.units) for (const skill of unit.enemSkills?.skills ?? []) {
      skill.description ??= descriptions.get(skill.code) ?? null
      if (!skill.description) throw new CurriculumPlanError(`A habilidade ${skill.code} não possui descrição no catálogo ENEM da disciplina.`)
    }
  }
  return selection
}
