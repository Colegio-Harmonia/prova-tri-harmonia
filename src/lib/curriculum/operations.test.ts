import { describe, expect, it } from 'vitest'
import { examPlanCoverage, groupIndicators, suggestActions, summarizeIndicators, type PlanIndicatorInput, type SkillSignal } from './operations'

describe('examPlanCoverage', () => {
  it('aponta habilidades planejadas que a prova não cobre e as que estão fora do plano', () => {
    const result = examPlanCoverage(
      [{ code: 'EF05MA03', description: 'Frações' }, { code: 'EF05MA04', description: 'Decimais' }, { code: 'EF05MA05', description: null }],
      [['ef05ma03'], ['EF05MA03', 'EF05MA10'], []],
    )
    expect(result).toEqual({
      plannedCount: 3, covered: ['EF05MA03'],
      missing: [{ code: 'EF05MA04', description: 'Decimais' }, { code: 'EF05MA05', description: null }],
      outsidePlan: ['EF05MA10'], unmappedQuestions: 1, coveragePercent: 33,
    })
  })

  it('sem planejamento não inventa cobertura', () => {
    expect(examPlanCoverage([], [['EF05MA03']])).toMatchObject({ plannedCount: 0, coveragePercent: null, outsidePlan: ['EF05MA03'] })
  })
})

describe('suggestActions', () => {
  const s = (code: string, patch: Partial<SkillSignal>): SkillSignal => ({ code, description: null, planned: true, evaluated: true, percent: 80, itemCount: 60, studentCount: 30, ...patch })

  it('sugere avaliar o que não foi avaliado e retomar o que está abaixo de 60% com amostra', () => {
    const suggestions = suggestActions([
      s('EF05MA01', { evaluated: false, percent: null, itemCount: 0 }),
      s('EF05MA02', { percent: 40 }),
      s('EF05MA03', { percent: 55, itemCount: 10 }), // amostra pequena para 30 alunos
      s('EF05MA04', { percent: 90 }),
      s('EF05MA99', { planned: false, evaluated: false, percent: null }),
    ])
    expect(suggestions.map((item) => [item.kind, item.codes])).toEqual([['avaliar', ['EF05MA01']], ['retomar', ['EF05MA02']]])
    expect(suggestions[1].reason).toContain('EF05MA02 (40%)')
  })

  it('não sugere retomada para habilidade que já tem intervenção aberta', () => {
    expect(suggestActions([s('EF05MA02', { percent: 40 })], new Set(['EF05MA02']))).toEqual([])
  })
})

describe('indicadores', () => {
  const plan = (patch: Partial<PlanIndicatorInput>): PlanIndicatorInput => ({ planId: 1, academicYear: 2027, segment: 'anos-iniciais', gradeYear: 5, subject: 'Matemática', bimester: 1, officialStatus: 'aprovado', openStatus: null, plannedCount: 10, evaluatedCount: 5, interventions: [], ...patch })

  it('resume aprovação, cobertura e intervenções (inclusive atrasadas)', () => {
    const summary = summarizeIndicators([
      plan({}),
      plan({ planId: 2, officialStatus: null, openStatus: 'em_revisao', plannedCount: 10, evaluatedCount: 0 }),
      plan({ planId: 3, officialStatus: null, openStatus: 'rascunho', interventions: [{ status: 'planejada', dueDate: '2027-03-01' }, { status: 'em_andamento', dueDate: null }, { status: 'concluida', dueDate: '2027-01-01' }] }),
    ], '2027-04-01')
    expect(summary).toEqual({ planCount: 3, approvedCount: 1, inReviewCount: 1, draftOnlyCount: 1, plannedSkillCount: 30, evaluatedSkillCount: 10, coveragePercent: 33, interventionsOpen: 2, interventionsOverdue: 1, interventionsDone: 1 })
  })

  it('agrupa por disciplina', () => {
    const groups = groupIndicators([plan({}), plan({ planId: 2, subject: 'Ciências' }), plan({ planId: 3 })], '2027-04-01', (item) => item.subject)
    expect(groups.map((group) => [group.label, group.planCount])).toEqual([['Ciências', 1], ['Matemática', 2]])
  })
})
