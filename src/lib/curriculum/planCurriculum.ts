import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { curriculumPlanSkills, curriculumPlanUnits, curriculumPlanVersions, curriculumPlans } from '@/db/schema'
import { parseObjetivos } from '@/lib/sheets/objetivosParser'
import type { CurricularUnit, CurriculumSelection, Segment } from '@/types/exam'

export class CurriculumPlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CurriculumPlanError'
  }
}

export type CurriculumScope = { segment: Segment; gradeYear: number; subject: string; bimester?: number }

export type PlanUnitRow = {
  position: number
  title: string
  content: string | null
  objectives: string | null
  skills: Array<{ code: string; description: string | null }>
}

/** O planejamento só chega à prova depois de aprovado; versão em rascunho nunca gera avaliação. */
export const PLAN_VERSION_STATUS_FOR_GENERATION = 'aprovado'

/** Lê o id do planejamento gravado na prova no momento da geração (se houve). */
export function planIdFromExamPayload(payload: unknown): number | undefined {
  const id = (payload as { metadata?: { curriculumPlanId?: unknown } } | null | undefined)?.metadata?.curriculumPlanId
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
      }
    })

  const unmappedWarnings = units
    .filter((unit) => unit.habilidades.status === 'nao_mapeado')
    .map((unit) => `"${unit.tituloCapitulo}": habilidade BNCC não mapeada (${unit.habilidades.reason}).`)

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
  if (plan.segment !== scope.segment || plan.gradeYear !== scope.gradeYear || plan.subject !== scope.subject || (scope.bimester !== undefined && plan.bimester !== scope.bimester)) {
    throw new CurriculumPlanError(`O planejamento #${planId} é de ${plan.subject}, ${plan.gradeYear}º ano, ${plan.bimester}º bimestre, e não corresponde ao recorte da prova.`)
  }

  const version = await db.query.curriculumPlanVersions.findFirst({
    where: and(eq(curriculumPlanVersions.planId, planId), eq(curriculumPlanVersions.status, PLAN_VERSION_STATUS_FOR_GENERATION)),
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

  return buildCurriculumFromPlan(
    { ...scope, bimester: scope.bimester ?? plan.bimester },
    `Planejamento interno #${planId} (versão ${version.versionNumber})`,
    units.map((unit) => ({ position: unit.position, title: unit.title, content: unit.content, objectives: unit.objectives, skills: skillsByUnit.get(unit.id) ?? [] })),
  )
}
