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
import { createPlan, getPlanDetail, patchDraftUnitFields, PlanningError, startNewVersion, type PlanScope, type Viewer } from '@/lib/curriculum/planningService'
import { parseEnemSkills } from '@/lib/sheets/enemSkillsParser'
import { normalizeEnemCode } from './recommendations'

export const APPLY_NOTE = 'Sugestões do Assistente de Planejamento aceitas pelo professor'

/** `codes` = habilidades ENEM (só Ensino Médio); `objectives` = objetivos de aprendizagem (qualquer segmento). */
export type ApplyItem = {
  bimester: number
  title: string
  codes?: string[]
  objectives?: string[]
  /** Quando a unidade não existe no planejamento do bimestre, cria-a no rascunho com este conteúdo. */
  createIfMissing?: { content?: string | null }
}
export type ApplyInput = Omit<PlanScope, 'bimester'> & {
  items: ApplyItem[]
  /** Cria o planejamento do bimestre quando ele não existe (só coordenação/direção, pela regra do planningService). */
  createPlanIfMissing?: boolean
}

export type BimesterApplyResult = {
  bimester: number
  status: 'aplicado' | 'sem_mudanca' | 'sem_planejamento' | 'bloqueado'
  message: string
  planId: number | null
  versionNumber: number | null
  /** Capítulos que receberam habilidades ou objetivos novos nesta chamada. */
  applied: Array<{ title: string; codes: string[]; objectives: string[]; created?: boolean }>
  /** Capítulos que não existem (ou aparecem repetidos) no planejamento do bimestre. */
  notFound: string[]
}

const squash = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase()

/** Índice da unidade com aquele título; -1 se não houver; -2 se houver mais de uma (ambíguo: nunca se escolhe nem se cria). */
export function matchUnitIndex(units: Array<{ title: string }>, title: string): number {
  const wanted = squash(title)
  const matches = units.map((unit, index) => (squash(unit.title) === wanted ? index : -1)).filter((index) => index >= 0)
  return matches.length === 1 ? matches[0] : matches.length === 0 ? -1 : -2
}

const sameText = (value: string) => squash(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.;]+$/, '')

/**
 * Acrescenta ao campo "Objetivos" as frases que a unidade ainda não tem, uma
 * por linha e terminadas em ponto (formato que `parseObjetivos` separa). O
 * texto que o professor já escreveu é preservado.
 */
export function mergeObjectives(existingRaw: string | null | undefined, objectives: string[]): { objectives: string | null; added: string[] } {
  const base = existingRaw?.trim() ?? ''
  const present = new Set(base.split(/\.\s+|\n+/).map(sameText).filter(Boolean))
  const added: string[] = []
  for (const raw of objectives) {
    const text = raw.replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '')
    if (!text || text.length > 300 || present.has(sameText(text))) continue
    present.add(sameText(text))
    added.push(text)
  }
  return { objectives: added.length ? [base, ...added.map((text) => `${text}.`)].filter(Boolean).join('\n') : base || null, added }
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

type UnitFields = { id: number; title: string; enemSkills: string | null; objectives: string | null }

/** Decide, sobre as unidades dadas, o que cada item acrescenta. Pura: usada no ensaio e dentro da transação. */
export function planChanges(units: UnitFields[], items: ApplyItem[], area: EnemAreaCode | null) {
  const enem = new Map(units.map((unit) => [unit.id, unit.enemSkills]))
  const objectives = new Map(units.map((unit) => [unit.id, unit.objectives]))
  const applied: BimesterApplyResult['applied'] = []
  const notFound: string[] = []
  const inserts: Array<{ title: string; content: string | null; objectives: string | null; enemSkills: string | null }> = []
  for (const item of items) {
    const index = matchUnitIndex(units, item.title)
    if (index === -1 && item.createIfMissing && item.title.trim()) {
      // Unidade ainda não trazida para o planejamento: nasce no rascunho com o que o professor escolheu.
      const title = item.title.replace(/\s+/g, ' ').trim()
      let created = inserts.find((unit) => squash(unit.title) === squash(title))
      const isNew = !created
      if (!created) { created = { title, content: item.createIfMissing.content?.trim() || null, objectives: null, enemSkills: null }; inserts.push(created) }
      const codes = area && item.codes?.length ? mergeEnemCodes(created.enemSkills, item.codes, area) : null
      const texts = item.objectives?.length ? mergeObjectives(created.objectives, item.objectives) : null
      if (codes) created.enemSkills = codes.enemSkills
      if (texts) created.objectives = texts.objectives
      if (isNew || codes?.added.length || texts?.added.length) applied.push({ title: created.title, codes: codes?.added ?? [], objectives: texts?.added ?? [], created: true })
      continue
    }
    if (index < 0) { notFound.push(item.title); continue }
    const unit = units[index]
    // Sem área do ENEM (fora do EM ou disciplina sem área), códigos são ignorados.
    const codes = area && item.codes?.length ? mergeEnemCodes(enem.get(unit.id), item.codes, area) : null
    const texts = item.objectives?.length ? mergeObjectives(objectives.get(unit.id), item.objectives) : null
    if (codes?.added.length) enem.set(unit.id, codes.enemSkills)
    if (texts?.added.length) objectives.set(unit.id, texts.objectives)
    if (codes?.added.length || texts?.added.length) applied.push({ title: unit.title, codes: codes?.added ?? [], objectives: texts?.added ?? [] })
  }
  const changes = units.flatMap((unit) => {
    const change: { unitId: number; enemSkills?: string | null; objectives?: string | null } = { unitId: unit.id }
    if (enem.get(unit.id) !== unit.enemSkills) change.enemSkills = enem.get(unit.id) ?? null
    if (objectives.get(unit.id) !== unit.objectives) change.objectives = objectives.get(unit.id) ?? null
    return Object.keys(change).length > 1 ? [change] : []
  })
  return { applied, notFound, changes, inserts }
}

async function applyToBimester(viewer: Viewer, scope: PlanScope, area: EnemAreaCode | null, items: ApplyItem[], createPlan_ = false): Promise<BimesterApplyResult> {
  const empty = { bimester: scope.bimester, planId: null, versionNumber: null, applied: [], notFound: [] }
  const [plan] = await db.select({ id: curriculumPlans.id }).from(curriculumPlans).where(and(
    eq(curriculumPlans.academicYear, scope.academicYear), eq(curriculumPlans.segment, scope.segment),
    eq(curriculumPlans.gradeYear, scope.gradeYear), eq(curriculumPlans.subject, scope.subject), eq(curriculumPlans.bimester, scope.bimester),
  ))
  let planId = plan?.id
  if (!planId) {
    if (!createPlan_) return { ...empty, status: 'sem_planejamento', message: `Ainda não existe planejamento do ${scope.bimester}º bimestre de ${scope.academicYear} na Prova TRI.` }
    try {
      planId = (await createPlan(viewer, scope)).planId
    } catch (error) {
      if (!(error instanceof PlanningError)) throw error
      return { ...empty, status: 'bloqueado', message: error.message }
    }
  }
  const plan_ = { id: planId }

  try {
    const detail = await getPlanDetail(viewer, plan_.id)
    const open = openVersion(detail.versions)
    if (open?.status === 'em_revisao') {
      return { ...empty, planId: plan_.id, versionNumber: open.versionNumber, status: 'bloqueado', message: `A versão ${open.versionNumber} está em revisão; aguarde a coordenação concluir antes de adicionar habilidades.` }
    }
    const base = open ?? officialVersion(detail.versions)
    if (!base) return { ...empty, planId: plan_.id, status: 'bloqueado', message: 'O planejamento ainda não tem nenhuma versão.' }

    // Ensaia a mudança sobre o conteúdo atual ANTES de abrir versão nova,
    // para não deixar rascunho vazio quando nada se aplica.
    const preview = planChanges((await getPlanDetail(viewer, plan_.id, base.id)).units.map((unit, index) => ({ id: index, title: unit.title, enemSkills: unit.enemSkills ?? null, objectives: unit.objectives ?? null })), items, area)
    if (!preview.applied.length) {
      return { ...empty, planId: plan_.id, versionNumber: base.versionNumber, notFound: preview.notFound, status: 'sem_mudanca', message: preview.notFound.length ? 'Os capítulos não foram encontrados no planejamento deste bimestre.' : 'O planejamento já tem esses itens.' }
    }

    const draft = open ?? await startNewVersion(viewer, plan_.id, APPLY_NOTE)
    const versionId = 'versionId' in draft ? draft.versionId : draft.id
    // A gravação refaz o cálculo dentro da transação, sobre as unidades
    // travadas: só o campo ENEM das unidades-alvo muda, e edição simultânea
    // de outro responsável não é sobrescrita.
    const { applied, notFound } = await patchDraftUnitFields(viewer, versionId, (units) => {
      const planned = planChanges(units, items, area)
      const codes = planned.applied.flatMap((entry) => entry.codes)
      const objectiveCount = planned.applied.reduce((sum, entry) => sum + entry.objectives.length, 0)
      const parts = [codes.length ? `habilidades ENEM ${codes.join(', ')}` : '', objectiveCount ? `${objectiveCount} objetivo(s)` : ''].filter(Boolean)
      const createdCount = planned.inserts.length
      if (createdCount) parts.unshift(`${createdCount} unidade(s) nova(s)`)
      return { changes: planned.changes, inserts: planned.inserts, summary: `adicionado pelo Assistente: ${parts.join(' e ') || 'nada'}`, result: planned }
    })
    if (!applied.length) {
      return { ...empty, planId: plan_.id, versionNumber: draft.versionNumber, notFound, status: 'sem_mudanca', message: 'O planejamento já tem esses itens.' }
    }
    return {
      bimester: scope.bimester, planId: plan_.id, versionNumber: draft.versionNumber, applied, notFound, status: 'aplicado',
      message: `${applied.some((entry) => entry.created) ? 'Unidade criada e adicionada' : 'Adicionado'} ao rascunho (versão ${draft.versionNumber}) do ${scope.bimester}º bimestre. Envie para revisão em Planejamentos para valer nas provas.`,
    }
  } catch (error) {
    if (!(error instanceof PlanningError)) throw error
    return { ...empty, planId: plan_.id, status: 'bloqueado', message: error.message }
  }
}

export async function applyAdvisorSuggestions(viewer: Viewer, input: ApplyInput): Promise<{ results: BimesterApplyResult[] }> {
  const rawArea = input.segment === 'ensino-medio' ? getEnemAreaForSubject(input.subject) : null
  const area = isEnemAreaCode(rawArea) ? rawArea : null
  if (input.items.some((item) => item.codes?.length)) {
    if (input.segment !== 'ensino-medio') throw new PlanningError('Habilidades do ENEM só se aplicam ao Ensino Médio.', 422)
    if (!area) throw new PlanningError(`${input.subject} não tem área do ENEM configurada.`, 422)
  }

  const byBimester = new Map<number, ApplyItem[]>()
  for (const item of input.items) byBimester.set(item.bimester, [...(byBimester.get(item.bimester) ?? []), item])

  const results: BimesterApplyResult[] = []
  for (const [bimester, items] of [...byBimester.entries()].sort((a, b) => a[0] - b[0])) {
    const { items: _items, createPlanIfMissing, ...scope } = input
    results.push(await applyToBimester(viewer, { ...scope, bimester }, area, items, createPlanIfMissing === true))
  }
  return { results }
}
