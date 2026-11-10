import { sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { getEnemAreaForSubject } from '@/config/enemAreaMap'
import type { ExamQuestion } from '@/lib/gemini/examSchema'
import { assessPlanningAlignment, assessPlanningAlignmentBatch, type PlanningTarget, type PlanningQuestion } from './planningAlignment'
import type { PlannedQuestionSlot } from './contentPlan'
import { buildPlannedQuestionSlots, validateCurriculumPlan } from './contentPlan'
import { pickTargetEnemSkill, pickTargetSkills } from './targetSkills'
import { planningTargetForUnit } from './planningAlignment'
import type { CurriculumSelection, CurriculumPlanItem } from '@/types/exam'
import { mapInBatches } from './questionConcurrency'

export type EnemCandidate = {
  id: number; year: number; question_index: number; language: string | null
  context: string | null; alternatives_introduction: string | null
  alternatives: Array<{ letter: string; text: string; file?: string | null; image?: NonNullable<NonNullable<ExamQuestion['alternatives']>[number]['image']> }> | null; correct_alternative: string
  skill_code: string | null; competency_number: number | null
  classification_source: string | null; files: string[] | null
}
export type EnemPlanningSlot = PlannedQuestionSlot & { target: PlanningTarget }
export type EnemAssignment = { questionId: number; slotNumber: number; alignment: NonNullable<ExamQuestion['planningAlignment']> }

export async function loadPlanningQuestionHistory(context: { subject: string; gradeYear: number; academicYear?: number; classLabel?: string; curriculumPlanId?: number }): Promise<ExamQuestion[]> {
  if (!context.classLabel?.trim() && !context.curriculumPlanId) return []
  const rows = await db.execute<{ questions: ExamQuestion[] }>(sql`
    SELECT generation_payload->'questions' AS questions FROM generated_exams
    WHERE subject=${context.subject} AND grade_year=${context.gradeYear}
      AND academic_year=${context.academicYear ?? new Date().getFullYear()}
      ${context.classLabel?.trim() ? sql`AND generation_payload->'metadata'->>'classLabel'=${context.classLabel.trim()}` : sql`AND generation_payload->'metadata'->>'curriculumPlanId'=${String(context.curriculumPlanId)}`}
      AND status IN ('aprovado','impresso','aplicado','parcialmente_corrigida','corrigido')
  `)
  return Array.from(rows).flatMap((row) => row.questions ?? [])
}

export function buildEnemPlanningSlots(curriculum: CurriculumSelection, plan: CurriculumPlanItem[], count: number, objectivePercentage: number, classLabel?: string): EnemPlanningSlot[] {
  validateCurriculumPlan(curriculum.units, plan, count)
  const offsets = new Map<number, number>()
  return buildPlannedQuestionSlots(plan, count, objectivePercentage).map((slot) => {
    const unit = curriculum.units.find((unit) => unit.rowIndex === slot.unitRowIndex)!
    const offset = offsets.get(unit.rowIndex) ?? 0
    offsets.set(unit.rowIndex, offset + 1)
    return { ...slot, target: planningTargetForUnit(unit, { ...curriculum, classLabel }, pickTargetEnemSkill({ unit, slotIndexInUnit: offset }), pickTargetSkills({ unit, slotIndexInUnit: offset }).map((skill) => skill.code)) }
  })
}

/** Unknown language is never assumed to be English. It remains reviewable manually. */
export function candidateLanguageMatches(candidate: EnemCandidate, subject: string): boolean {
  const language = candidate.language?.toLowerCase().trim() ?? ''
  if (/ingl/i.test(subject)) return ['ingles', 'inglês', 'english', 'en'].includes(language)
  if (/espan/i.test(subject)) return ['espanhol', 'español', 'spanish', 'es'].includes(language)
  return !language
}

export type EnemCandidateFilters = { year?: number; questionIndex?: number; q?: string; bloomLevel?: string; skillCode?: string; cognitiveAxis?: string }

export async function loadPlannedEnemCandidates(subject: string, ids?: number[], filters: EnemCandidateFilters = {}): Promise<EnemCandidate[]> {
  const area = getEnemAreaForSubject(subject)
  if (!area || ids?.length === 0) return []
  const rows = await db.execute<EnemCandidate>(sql`
    SELECT q.id,q.year,q.question_index,q.language,q.context,q.alternatives_introduction,
      q.alternatives,q.correct_alternative,q.files,s.code AS skill_code,
      ec.number AS competency_number,c.enem_classification_source AS classification_source
    FROM imported_questions q
    LEFT JOIN imported_question_classifications c ON c.question_id=q.id AND c.source='enem'
    LEFT JOIN enem_skills s ON s.id=c.enem_skill_id
    LEFT JOIN enem_competencies ec ON ec.id=s.competency_id
    LEFT JOIN enem_cognitive_axes ax ON ax.id=c.enem_cognitive_axis_id
    WHERE q.source='enem' AND q.discipline=${area}
      ${ids ? sql`AND q.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`,`)})` : sql``}
      ${filters.year ? sql`AND q.year=${filters.year}` : sql``}
      ${filters.questionIndex ? sql`AND q.question_index=${filters.questionIndex}` : sql``}
      ${filters.q ? sql`AND concat_ws(' ',q.context,q.alternatives_introduction,q.title) ILIKE ${`%${filters.q}%`}` : sql``}
      ${filters.bloomLevel ? sql`AND c.bloom_level=${filters.bloomLevel}` : sql``}
      ${filters.skillCode ? sql`AND s.code=${filters.skillCode}` : sql``}
      ${filters.cognitiveAxis ? sql`AND ax.code=${filters.cognitiveAxis}` : sql``}
    ORDER BY q.year DESC,q.question_index,q.id
  `)
  const seen = new Set<string>()
  return Array.from(rows).filter((candidate) => {
    const key = JSON.stringify([candidate.context, candidate.alternatives_introduction, candidate.alternatives]).normalize('NFKC').toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function candidateAsQuestion(candidate: EnemCandidate): PlanningQuestion {
  return { number: 1, statement: candidate.alternatives_introduction ?? '',
    supportText: candidate.context, alternatives: candidate.alternatives, correctLetter: candidate.correct_alternative,
  }
}

function eligible(candidate: EnemCandidate, slot: EnemPlanningSlot): boolean {
  if (slot.type !== 'objetiva') return false
  if (!candidateLanguageMatches(candidate, slot.target.subject)) return false
  const target = slot.target.targetEnemSkill
  if (target && (candidate.skill_code !== target.code.split(':')[1] || candidate.competency_number !== Number(target.code.match(/^C(\d+)/)?.[1]))) return false
  if (!candidate.context?.trim() && !candidate.alternatives_introduction?.trim()) return false
  if (!candidate.alternatives || candidate.alternatives.length !== 5 || !candidate.correct_alternative
    || !candidate.alternatives.some((alternative) => alternative.letter === candidate.correct_alternative)) return false
  if (candidate.alternatives.some((alternative) => !alternative.text?.trim() && !alternative.file && !alternative.image)) return false
  const visual = Boolean(candidate.files?.length || candidate.alternatives.some((alternative) => alternative.image || alternative.file))
  if (slot.visualAid === 'sem_imagem' && visual || slot.visualAid === 'obrigatorio' && !visual) return false
  return true
}

/** Maximum matching: a flexible item must not steal the only slot another item can fill. */
export function matchEnemAssignments(edges: Array<{ questionId: number; slotNumber: number; alignment: EnemAssignment['alignment'] }>, count: number): EnemAssignment[] {
  const bySlot = new Map<number, EnemAssignment[]>()
  for (const edge of edges) { const list = bySlot.get(edge.slotNumber) ?? []; list.push(edge); bySlot.set(edge.slotNumber, list) }
  const byQuestion = new Map<number, EnemAssignment>()
  function visit(slot: number, seen: Set<number>): boolean {
    for (const edge of bySlot.get(slot) ?? []) {
      if (seen.has(edge.questionId)) continue
      seen.add(edge.questionId)
      const previous = byQuestion.get(edge.questionId)
      if (!previous || visit(previous.slotNumber, seen)) { byQuestion.set(edge.questionId, edge); return true }
    }
    return false
  }
  // Round-robin slot order is supplied by the caller to distribute origins across units.
  for (const slot of bySlot.keys()) { if (byQuestion.size >= count) break; visit(slot, new Set()) }
  return [...byQuestion.values()].sort((a, b) => a.slotNumber - b.slotNumber)
}

export async function selectPlannedEnemQuestions(params: {
  candidates: EnemCandidate[]; slots: EnemPlanningSlot[]; count: number; strictLanguage?: boolean
  preferredIds?: number[]
  assess?: typeof assessPlanningAlignment
}): Promise<{ assignments: EnemAssignment[]; warnings: string[] }> {
  const edges: EnemAssignment[] = []
  // Interleave units so early chapters cannot absorb the entire ENEM quota.
  const queues = new Map<number, EnemPlanningSlot[]>()
  for (const slot of params.slots) { const queue = queues.get(slot.unitRowIndex) ?? []; queue.push(slot); queues.set(slot.unitRowIndex, queue) }
  const ordered: EnemPlanningSlot[] = []
  while ([...queues.values()].some((queue) => queue.length)) for (const queue of queues.values()) { const slot = queue.shift(); if (slot) ordered.push(slot) }
  const slotOrder = new Map(ordered.map((slot, index) => [slot.number, index]))
  const match = () => matchEnemAssignments([...edges].sort((a, b) => slotOrder.get(a.slotNumber)! - slotOrder.get(b.slotNumber)!), params.count)

  // Positions with the same target share judgments and a progressive cursor.
  // An aligned item contributes to every eligible position of that target.
  const groups = new Map<string, { slots: EnemPlanningSlot[]; candidates: EnemCandidate[]; cursor: number }>()
  for (const slot of ordered) {
    if (slot.type !== 'objetiva') continue
    const key = JSON.stringify([slot.target, slot.visualAid])
    const existing = groups.get(key)
    if (existing) { existing.slots.push(slot); continue }
    const candidates = params.candidates.filter((candidate) => eligible(candidate, slot))
    // Lexical proximity orders the search; semantic judgment establishes compatibility.
    const words = [...new Set(`${slot.target.unitTitle} ${slot.target.curriculumContent ?? ''}`.toLowerCase().match(/[\p{L}]{4,}/gu) ?? [])]
    const relevance = (candidate: EnemCandidate) => {
      const text = `${candidate.context ?? ''} ${candidate.alternatives_introduction ?? ''} ${candidate.alternatives?.map((alternative) => alternative.text).join(' ') ?? ''}`.toLowerCase()
      return words.filter((word) => text.includes(word)).length
    }
    const scores = new Map(candidates.map((candidate) => [candidate.id, relevance(candidate)]))
    candidates.sort((a, b) => Number(params.preferredIds?.includes(b.id) ?? false) - Number(params.preferredIds?.includes(a.id) ?? false) || scores.get(b.id)! - scores.get(a.id)! || b.year - a.year || a.id - b.id)
    groups.set(key, { slots: [slot], candidates, cursor: 0 })
  }
  let examined = 0
  // Small batches bound each provider request, not the depth of the bank search.
  // Continue round-robin until the quota is filled or every eligible item is checked.
  while (match().length < params.count && [...groups.values()].some((group) => group.cursor < group.candidates.length)) {
    for (const group of groups.values()) {
      const batch = group.candidates.slice(group.cursor, group.cursor + 8)
      if (!batch.length) continue
      const target = group.slots[0]!.target
      const assessments = params.assess
        ? await mapInBatches(batch, (candidate) => params.assess!(candidateAsQuestion(candidate), target))
        : await assessPlanningAlignmentBatch(batch.map(candidateAsQuestion), target)
      if (assessments.length !== batch.length || assessments.some((assessment) => assessment.status === 'unavailable')) {
        throw new Error('A conferência de aderência ao planejamento está indisponível. Tente novamente; nenhuma questão foi presumida compatível.')
      }
      group.cursor += batch.length
      examined += batch.length
      console.info('[enem/planning] lote conferido', { slotNumbers: group.slots.map((slot) => slot.number), examined: group.cursor, candidateCount: group.candidates.length, aligned: assessments.filter((assessment) => assessment.status === 'aligned').length })
      assessments.forEach((alignment, index) => {
        if (alignment.status !== 'aligned') return
        for (const slot of group.slots) edges.push({ questionId: batch[index]!.id, slotNumber: slot.number, alignment })
      })
    }
  }
  const assignments = match()
  console.info('[enem/planning] busca progressiva concluída', {
    requested: params.count, found: assignments.length, examined,
    groups: [...groups.values()].map((group) => ({ slotNumbers: group.slots.map((slot) => slot.number), candidateCount: group.candidates.length, examined: group.cursor })),
  })
  const warnings = assignments.length < params.count
    ? [`Solicitadas ${params.count} questões ENEM; encontradas ${assignments.length} compatíveis após conferir todos os candidatos elegíveis para o planejamento e os filtros. Nenhuma habilidade foi substituída.`]
    : []
  return { assignments, warnings }
}
