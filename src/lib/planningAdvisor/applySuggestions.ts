/**
 * Assistente de Planejamento — leva habilidades ENEM escolhidas pelo
 * professor para o planejamento interno (`/planejamento`), sempre numa
 * versão em RASCUNHO. Nada aqui aprova nem altera versão oficial: a mudança
 * segue o fluxo normal de revisão/aprovação, e toda escrita passa por
 * `planningService` (mesmas permissões e travas de quem edita pela tela).
 */
import { and, eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { curriculumPlans } from '@/db/schema'
import { getEnemAreaForSubject } from '@/config/enemAreaMap'
import { isEnemAreaCode, isValidEnemPair, type EnemAreaCode } from '@/config/enemMatrix'
import { officialVersion, openVersion } from '@/lib/curriculum/planningPolicy'
import { getPlanDetail, patchDraftEnemSkills, PlanningError, startNewVersion, type PlanScope, type Viewer } from '@/lib/curriculum/planningService'
import { parseEnemSkills } from '@/lib/sheets/enemSkillsParser'
import { normalizeEnemCode } from './recommendations'

export const APPLY_NOTE = 'Habilidades ENEM adicionadas pelo Assistente de Planejamento'

export type ApplyItem = { bimester: number; title: string; codes: string[] }
export type ApplyInput = Omit<PlanScope, 'bimester'> & { items: ApplyItem[] }

export type BimesterApplyResult = {
  bimester: number
  status: 'aplicado' | 'sem_mudanca' | 'sem_planejamento' | 'bloqueado'
  message: string
  planId: number | null
  versionNumber: number | null
  /** Capítulos que receberam códigos novos nesta chamada. */
  applied: Array<{ title: string; codes: string[] }>
  /** Capítulos que não existem (ou aparecem repetidos) no planejamento do bimestre. */
  notFound: string[]
}

const squash = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()

/** Índice da unidade com aquele título; -1 se não houver ou se houver mais de uma (ambíguo). */
export function matchUnitIndex(units: Array<{ title: string }>, title: string): number {
  const wanted = squash(title)
  const matches = units.map((unit, index) => (squash(unit.title) === wanted ? index : -1)).filter((index) => index >= 0)
  return matches.length === 1 ? matches[0] : -1
}

/**
 * Acrescenta ao campo "Habilidades ENEM" só os códigos válidos na área e que
 * a unidade ainda não tem. O texto existente (pesos e origens) é preservado.
 */
export function mergeEnemCodes(existingRaw: string | null | undefined, codes: string[], area: EnemAreaCode): { enemSkills: string | null; added: string[] } {
  const present = new Set(parseEnemSkills(existingRaw, area).skills.map((skill) => skill.code))
  const added: string[] = []
  for (const raw of codes) {
    const code = normalizeEnemCode(raw)
    const match = code ? /^C(\d+):H(\d+)$/.exec(code) : null
    if (!code || !match || !isValidEnemPair(area, Number(match[1]), Number(match[2])) || present.has(code)) continue
    present.add(code)
    added.push(code)
  }
  const base = existingRaw?.trim() ?? ''
  return { enemSkills: added.length ? [base, ...added].filter(Boolean).join('\n') : base || null, added }
}

/** Decide, sobre as unidades dadas, o que cada item acrescenta. Pura: usada no ensaio e dentro da transação. */
export function planChanges(units: Array<{ id: number; title: string; enemSkills: string | null }>, items: ApplyItem[], area: EnemAreaCode) {
  const current = new Map(units.map((unit) => [unit.id, unit.enemSkills]))
  const applied: BimesterApplyResult['applied'] = []
  const notFound: string[] = []
  for (const item of items) {
    const index = matchUnitIndex(units, item.title)
    if (index < 0) { notFound.push(item.title); continue }
    const unit = units[index]
    const merged = mergeEnemCodes(current.get(unit.id), item.codes, area)
    if (!merged.added.length) continue
    current.set(unit.id, merged.enemSkills)
    applied.push({ title: unit.title, codes: merged.added })
  }
  const changes = units.filter((unit) => current.get(unit.id) !== unit.enemSkills).map((unit) => ({ unitId: unit.id, enemSkills: current.get(unit.id) ?? null }))
  return { applied, notFound, changes }
}

async function applyToBimester(viewer: Viewer, scope: PlanScope, area: EnemAreaCode, items: ApplyItem[]): Promise<BimesterApplyResult> {
  const empty = { bimester: scope.bimester, planId: null, versionNumber: null, applied: [], notFound: [] }
  const [plan] = await db.select({ id: curriculumPlans.id }).from(curriculumPlans).where(and(
    eq(curriculumPlans.academicYear, scope.academicYear), eq(curriculumPlans.segment, scope.segment),
    eq(curriculumPlans.gradeYear, scope.gradeYear), eq(curriculumPlans.subject, scope.subject), eq(curriculumPlans.bimester, scope.bimester),
  ))
  if (!plan) {
    return { ...empty, status: 'sem_planejamento', message: `Ainda não existe planejamento do ${scope.bimester}º bimestre de ${scope.academicYear} na Prova TRI.` }
  }

  try {
    const detail = await getPlanDetail(viewer, plan.id)
    const open = openVersion(detail.versions)
    if (open?.status === 'em_revisao') {
      return { ...empty, planId: plan.id, versionNumber: open.versionNumber, status: 'bloqueado', message: `A versão ${open.versionNumber} está em revisão; aguarde a coordenação concluir antes de adicionar habilidades.` }
    }
    const base = open ?? officialVersion(detail.versions)
    if (!base) return { ...empty, planId: plan.id, status: 'bloqueado', message: 'O planejamento ainda não tem nenhuma versão.' }

    // Ensaia a mudança sobre o conteúdo atual ANTES de abrir versão nova,
    // para não deixar rascunho vazio quando nada se aplica.
    const preview = planChanges((await getPlanDetail(viewer, plan.id, base.id)).units.map((unit, index) => ({ id: index, title: unit.title, enemSkills: unit.enemSkills ?? null })), items, area)
    if (!preview.applied.length) {
      return { ...empty, planId: plan.id, versionNumber: base.versionNumber, notFound: preview.notFound, status: 'sem_mudanca', message: preview.notFound.length ? 'Os capítulos não foram encontrados no planejamento deste bimestre.' : 'O planejamento já tem essas habilidades.' }
    }

    const draft = open ?? await startNewVersion(viewer, plan.id, APPLY_NOTE)
    const versionId = 'versionId' in draft ? draft.versionId : draft.id
    // A gravação refaz o cálculo dentro da transação, sobre as unidades
    // travadas: só o campo ENEM das unidades-alvo muda, e edição simultânea
    // de outro responsável não é sobrescrita.
    const { applied, notFound } = await patchDraftEnemSkills(viewer, versionId, (units) => {
      const planned = planChanges(units, items, area)
      const codes = planned.applied.flatMap((entry) => entry.codes)
      return { changes: planned.changes, summary: `habilidades ENEM adicionadas pelo Assistente (${codes.join(', ') || 'nenhuma'})`, result: planned }
    })
    if (!applied.length) {
      return { ...empty, planId: plan.id, versionNumber: draft.versionNumber, notFound, status: 'sem_mudanca', message: 'O planejamento já tem essas habilidades.' }
    }
    return {
      bimester: scope.bimester, planId: plan.id, versionNumber: draft.versionNumber, applied, notFound, status: 'aplicado',
      message: `Adicionado ao rascunho (versão ${draft.versionNumber}) do ${scope.bimester}º bimestre. Envie para revisão em Planejamentos para valer nas provas.`,
    }
  } catch (error) {
    if (!(error instanceof PlanningError)) throw error
    return { ...empty, planId: plan.id, status: 'bloqueado', message: error.message }
  }
}

export async function applyEnemSuggestions(viewer: Viewer, input: ApplyInput): Promise<{ results: BimesterApplyResult[] }> {
  if (input.segment !== 'ensino-medio') throw new PlanningError('Habilidades do ENEM só se aplicam ao Ensino Médio.', 422)
  const area = getEnemAreaForSubject(input.subject)
  if (!isEnemAreaCode(area)) throw new PlanningError(`${input.subject} não tem área do ENEM configurada.`, 422)

  const byBimester = new Map<number, ApplyItem[]>()
  for (const item of input.items) byBimester.set(item.bimester, [...(byBimester.get(item.bimester) ?? []), item])

  const results: BimesterApplyResult[] = []
  for (const [bimester, items] of [...byBimester.entries()].sort((a, b) => a[0] - b[0])) {
    const { items: _items, ...scope } = input
    results.push(await applyToBimester(viewer, { ...scope, bimester }, area, items))
  }
  return { results }
}
