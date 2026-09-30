// Teste de integração do Bloco 8 (operação institucional) contra Postgres
// real em memória (PGlite): planejamento × provas × correções × intervenções.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb, pgliteInstalled } from '@/test/pgliteDb'

const pgliteAvailable = pgliteInstalled()

const state: { db?: unknown } = {}
vi.mock('@/db/client', () => ({ get db() { return state.db } }))
vi.mock('./bnccDescriptions', () => ({ enrichBnccDescriptions: async <T,>(skills: T[]) => skills }))

const question = (number: number, codes: string[], weight = 1) => ({ number, type: 'objetiva', weight, bnccCodes: codes, bnccStatus: codes.length ? 'mapeado' : 'nao_mapeado', bnccSummary: null })
const answer = (questionNumber: number, isCorrect: boolean) => ({ questionNumber, type: 'objetiva', transcribedAnswer: 'A', correctLetter: 'A', isCorrect, aiSuggestedGrade: null, aiSuggestedFeedback: null, finalGrade: null, finalFeedback: null, weight: 1 })

describe.skipIf(!pgliteAvailable)('operação institucional (Postgres real)', () => {
  let pg: import('@electric-sql/pglite').PGlite
  let data: typeof import('./operationsData')
  let ops: typeof import('./operations')
  let planning: typeof import('./planningService')
  let decisions: typeof import('./decisionLog')
  const coord = { id: 1, role: 'coordenacao' as const }

  async function exam(id: number, questions: ReturnType<typeof question>[], corrections: Array<{ student: string; answers: ReturnType<typeof answer>[] }>) {
    await pg.query(`insert into generated_exams (id, created_by, segment, grade_year, subject, academic_year, bimester, exam_kind, question_count, objective_count, discursive_count, generation_payload) values ($1, 1, 'anos-iniciais', 5, 'Português', 2027, 1, 'prova', $2, $2, 0, $3)`, [id, questions.length, JSON.stringify({ questions })])
    for (const correction of corrections) await pg.query(`insert into exam_corrections (exam_id, student_name, classroom_student_id, answers, created_by, status, attendance_status) values ($1, $2, $2, $3, 1, 'revisado', 'presente')`, [id, correction.student, JSON.stringify(correction.answers)])
  }

  beforeAll(async () => {
    const created = await createTestDb()
    pg = created.pg
    await pg.exec(`insert into users (id, name, email, role) values (1, 'Coord', 'c@x', 'coordenacao')`)
    state.db = created.db
    data = await import('./operationsData')
    ops = await import('./operations')
    planning = await import('./planningService')
    decisions = await import('./decisionLog')
  }, 60_000)

  it('cruza planejamento aprovado, prova e correções; sugere e registra decisões', async () => {
    const { planId, versionId } = await planning.createPlan(coord, { academicYear: 2027, segment: 'anos-iniciais', gradeYear: 5, subject: 'Língua Portuguesa', bimester: 1 })
    await planning.saveDraft(coord, versionId, [{ title: 'Leitura', skills: [{ code: 'EF05LP01' }, { code: 'EF05LP02' }, { code: 'EF05LP03' }] }])
    await planning.transitionVersion(coord, versionId, 'em_revisao')
    await planning.transitionVersion(coord, versionId, 'aprovado')

    // Prova 1: cobre LP01 e LP02, não cobre LP03, traz LP99 (fora do plano) e uma questão sem código.
    await exam(101, [question(1, ['EF05LP01']), question(2, ['EF05LP02']), question(3, ['EF05LP99']), question(4, [])], [
      { student: 'a1', answers: [answer(1, true), answer(2, false), answer(3, true), answer(4, true)] },
      { student: 'a2', answers: [answer(1, true), answer(2, false), answer(3, false), answer(4, true)] },
    ])

    // "Português" na prova encontra o planejamento de "Língua Portuguesa".
    const found = await data.findPlanForScope({ academicYear: 2027, segment: 'anos-iniciais', gradeYear: 5, subject: 'Português', bimester: 1 })
    expect(found?.id).toBe(planId)
    const planned = (await data.plannedSkillsByPlan([planId])).get(planId)!
    expect(planned.map((skill) => skill.code)).toEqual(['EF05LP01', 'EF05LP02', 'EF05LP03'])

    const coverage = ops.examPlanCoverage(planned, [['EF05LP01'], ['EF05LP02'], ['EF05LP99'], []])
    expect(coverage).toMatchObject({ covered: ['EF05LP01', 'EF05LP02'], missing: [{ code: 'EF05LP03' }], outsidePlan: ['EF05LP99'], unmappedQuestions: 1, coveragePercent: 67 })

    let evidence = await data.loadScopeEvidence({ academicYear: 2027, segment: 'anos-iniciais', gradeYear: 5, bimester: 1 }, 'Língua Portuguesa')
    let signals = data.skillSignals(planned, evidence)
    const byCode = Object.fromEntries(signals.map((signal) => [signal.code, signal]))
    expect(byCode.EF05LP01).toMatchObject({ planned: true, evaluated: true, percent: 100, itemCount: 2, studentCount: 2 })
    expect(byCode.EF05LP02).toMatchObject({ evaluated: true, percent: 0, itemCount: 2 })
    expect(byCode.EF05LP03).toMatchObject({ planned: true, evaluated: false })
    expect(byCode.EF05LP99).toMatchObject({ planned: false, evaluated: true })
    // LP02 a 0%, mas só 1 item por aluno: amostra insuficiente para sugerir retomada.
    expect(ops.suggestActions(signals).map((item) => [item.kind, item.codes])).toEqual([['avaliar', ['EF05LP03']]])

    // Prova 2 reforça LP02 (2 itens por aluno no total) → vira sugestão de retomada.
    await exam(102, [question(1, ['EF05LP02'])], [{ student: 'a1', answers: [answer(1, false)] }, { student: 'a2', answers: [answer(1, true)] }])
    evidence = await data.loadScopeEvidence({ academicYear: 2027, segment: 'anos-iniciais', gradeYear: 5, bimester: 1 }, 'Língua Portuguesa')
    signals = data.skillSignals(planned, evidence)
    expect(ops.suggestActions(signals).map((item) => [item.kind, item.codes])).toEqual([['avaliar', ['EF05LP03']], ['retomar', ['EF05LP02']]])

    // Intervenção aberta ligada a LP02 → sai das sugestões; aparece no recorte do planejamento.
    await pg.query(`insert into pedagogical_interventions (segment, grade_year, subject, academic_year, bimester, skill_codes, action, owner_name, created_by) values ('anos-iniciais', 5, 'Português', 2027, 1, '{EF05LP02}', 'Oficina de leitura', 'Prof. A', 1)`)
    const interventions = await data.interventionsForScope({ academicYear: 2027, segment: 'anos-iniciais', gradeYear: 5, subject: 'Língua Portuguesa', bimester: 1 })
    expect(interventions.map((item) => item.skillCodes)).toEqual([['EF05LP02']])
    const targeted = new Set(interventions.flatMap((item) => item.skillCodes))
    expect(ops.suggestActions(signals, targeted).map((item) => item.kind)).toEqual(['avaliar'])

    // Histórico de decisões do planejamento: criação, edição (com habilidades adicionadas) e aprovação.
    await decisions.recordDecision(state.db as never, { entityType: 'intervencao', entityId: 1, planId, action: 'intervencao_criada', summary: 'Intervenção registrada: Oficina de leitura (EF05LP02)', actorId: 1 })
    const log = await decisions.planDecisions(planId)
    const actions = log.map((item) => item.action)
    expect(actions).toEqual(expect.arrayContaining(['criado', 'conteudo_salvo', 'status_em_revisao', 'status_aprovado', 'intervencao_criada']))
    expect(log.find((item) => item.action === 'conteudo_salvo')?.summary).toContain('+EF05LP01, EF05LP02, EF05LP03')
    expect(log.every((item) => item.actor === 'Coord')).toBe(true)
  })
})
