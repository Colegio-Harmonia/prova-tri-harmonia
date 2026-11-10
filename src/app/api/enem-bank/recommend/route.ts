import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth/auth'
import { getCurriculumFromPlan, CurriculumPlanError } from '@/lib/curriculum/planCurriculum'
import { buildEnemPlanningSlots, loadPlannedEnemCandidates, selectPlannedEnemQuestions, loadPlanningQuestionHistory } from '@/lib/exams/plannedEnemSelection'

const schema = z.object({
  curriculumPlanId: z.number().int().positive(), curriculumPlanVersionId: z.number().int().positive(),
  subject: z.string().min(1), gradeYear: z.number().int().min(1).max(3),
  academicYear: z.number().int().min(2020).max(2100), bimester: z.number().int().min(1).max(4),
  classLabel: z.string().max(120).optional(), count: z.number().int().min(1).max(30),
  total: z.number().int().min(10).max(30), objectivePercentage: z.number().min(0).max(100),
  filters: z.object({
    year: z.number().int().min(1998).max(2100).optional(),
    questionIndex: z.number().int().min(1).max(180).optional(),
    q: z.string().trim().max(500).optional(), bloomLevel: z.string().max(40).optional(),
    skillCode: z.string().regex(/^H([1-9]|[12][0-9]|30)$/).optional(), cognitiveAxis: z.enum(['DL', 'CF', 'SP', 'CA', 'EP']).optional(),
  }).optional(),
  preferredIds: z.array(z.number().int().positive()).max(30).optional(),
  contentPlan: z.array(z.object({ unitRowIndex: z.number().int().nonnegative(), questionCount: z.number().int().min(0).max(30), priority: z.enum(['alta', 'media', 'baixa']), visualAid: z.enum(['auto', 'obrigatorio', 'sem_imagem']) })).min(1).max(60),
})

export async function POST(req: NextRequest) {
  if (!(await auth())?.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Revise o planejamento e a quantidade de questões ENEM.', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  try {
    if (input.count > input.total) throw new Error('A quantidade ENEM não pode exceder o total da prova.')
    const curriculum = await getCurriculumFromPlan(input.curriculumPlanId, { ...input, segment: 'ensino-medio' })
    const effectivePercentage = Math.max(input.objectivePercentage, input.count / input.total * 100)
    const slots = buildEnemPlanningSlots(curriculum, input.contentPlan, input.total, effectivePercentage, input.classLabel)
    const candidates = await loadPlannedEnemCandidates(input.subject, undefined, input.filters)
    const history = await loadPlanningQuestionHistory(input)
    const used = new Set(history.flatMap((question) => question.enemBankRef ? [question.enemBankRef.questionId] : []))
    const result = await selectPlannedEnemQuestions({ candidates: candidates.filter((candidate) => !used.has(candidate.id) || input.preferredIds?.includes(candidate.id)), slots, count: input.count, preferredIds: input.preferredIds })
    const selected = new Set(result.assignments.map((assignment) => assignment.questionId))
    if (input.preferredIds?.some((id) => !selected.has(id))) throw new Error('Uma escolha manual não se encaixou nas posições conferidas. A seleção anterior foi mantida; revise os itens ou a distribuição por capítulos.')
    const questions = result.assignments.map((assignment) => {
      const candidate = candidates.find((candidate) => candidate.id === assignment.questionId)!
      return { id: candidate.id, year: candidate.year, questionIndex: candidate.question_index,
        preview: [candidate.context, candidate.alternatives_introduction].filter(Boolean).join(' ').slice(0, 220),
        skillCode: candidate.skill_code, skillDescription: null, competencyNumber: candidate.competency_number,
        classificationSource: candidate.classification_source ?? 'nunca_classificado', bloomLevel: null, cognitiveAxis: null }
    })
    return NextResponse.json({ ...result, questions, planReference: curriculum.planReference, complete: result.assignments.length === input.count })
  } catch (error) {
    console.warn('[enem/planning] recomendação não concluída', { category: error instanceof CurriculumPlanError ? 'invalid_plan' : 'selection_failed' })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Não foi possível conferir as questões ENEM.' }, { status: 422 })
  }
}
