import { describe, expect, it } from 'vitest'
import { buildTrajectory, dedupeEvidence, type TrajectoryEvidence } from './trajectory'

const scope = { academicYear: 2026, segment: 'anos-iniciais', gradeYear: 5, subject: 'Matemática' }
let q = 0
function items(code: string, bimester: number, examId: number, earned: number[], studentKey = 'a1', assessedAt = `2026-0${bimester * 2}-15T00:00:00.000Z`): TrajectoryEvidence[] {
  return earned.map((value) => ({ ...scope, code, bimester, examId, questionNumber: ++q, earnedPoints: value, possiblePoints: 1, studentKey, assessedAt }))
}

describe('buildTrajectory', () => {
  it('separa evolução real (mesmo conjunto) do efeito da troca de habilidades', () => {
    // Bim 1: MA01 50% (2 itens) + MA02 100% (2 itens) = 75%.
    // Bim 2: MA01 100% (2 itens) + MA03 0% (2 itens) = 50%.
    // Total caiu 25, mas na habilidade comum (MA01) subiu 50: a queda vem de MA03, conteúdo novo.
    const evidence = [...items('MA01', 1, 1, [1, 0]), ...items('MA02', 1, 1, [1, 1]), ...items('MA01', 2, 2, [1, 1]), ...items('MA03', 2, 2, [0, 0])]
    const [trajectory] = buildTrajectory(evidence, [], [])
    expect(trajectory.bimesters.map((point) => [point.bimester, point.percent])).toEqual([[1, 75], [2, 50]])
    expect(trajectory.transitions[0]).toMatchObject({ totalChange: -25, sameSetChange: 50, compositionEffect: -75, commonSkills: ['MA01'], addedSkills: ['MA03'], removedSkills: ['MA02'] })
    expect(trajectory.skillChanges).toEqual([expect.objectContaining({ code: 'MA01', fromPercent: 50, toPercent: 100, change: 50, status: 'avancou' })])
  })

  it('só afirma mudança com itens suficientes dos dois lados e acima da margem', () => {
    const [t] = buildTrajectory([
      ...items('MA01', 1, 1, [1]), ...items('MA01', 2, 2, [0, 0]), // 1 item antes: sem base
      ...items('MA02', 1, 1, [1, 1, 0]), ...items('MA02', 2, 2, [1, 1, 0]), // igual: estável
      ...items('MA03', 1, 1, [1, 1]), ...items('MA03', 2, 2, [0, 0, 1]), // 100 → 33: regrediu
    ], [], [])
    const status = Object.fromEntries(t.skillChanges.map((change) => [change.code, change.status]))
    expect(status).toEqual({ MA01: 'sem_base', MA02: 'estavel', MA03: 'regrediu' })
  })

  it('cobertura acumulada do planejamento por bimestre', () => {
    const planned = [
      { ...scope, bimester: 1, code: 'MA01' }, { ...scope, bimester: 1, code: 'MA02' },
      { ...scope, bimester: 2, code: 'MA03' }, { ...scope, bimester: 3, code: 'MA04' },
    ]
    const [t] = buildTrajectory([...items('MA01', 1, 1, [1]), ...items('MA03', 2, 2, [1])], planned, [])
    expect(t.coverage.map((point) => [point.bimester, point.evaluatedCumulative, point.plannedCumulative, point.percent])).toEqual([[1, 1, 2, 50], [2, 2, 3, 67], [3, 2, 4, 50]])
    expect(t.coverage[2].notYetEvaluated).toEqual(['MA02', 'MA04'])
  })

  it('compara resultados antes e depois da intervenção, sem inventar efeito sem dados', () => {
    const evidence = [...items('MA01', 1, 1, [0, 0, 1]), ...items('MA01', 2, 2, [1, 1, 1])]
    const base = { segment: scope.segment, gradeYear: 5, subject: 'Matemática', academicYear: 2026, action: 'Reforço de frações', ownerName: 'Prof.', status: 'concluida', dueDate: null }
    const [t] = buildTrajectory(evidence, [], [
      { ...base, id: 1, createdAt: '2026-03-01T00:00:00.000Z' },
      { ...base, id: 2, createdAt: '2026-12-01T00:00:00.000Z' },
      { ...base, id: 3, subject: 'Ciências', createdAt: '2026-03-01T00:00:00.000Z' },
    ])
    expect(t.interventions.map((item) => item.id)).toEqual([1, 2])
    expect(t.interventions[0]).toMatchObject({ before: { percent: 33.3, itemCount: 3 }, after: { percent: 100, itemCount: 3 }, change: 66.7, reading: 'melhora_posterior' })
    expect(t.interventions[1].reading).toBe('sem_avaliacao_posterior')
  })

  it('intervenção ligada a habilidades compara antes/depois só nelas', () => {
    const evidence = [...items('MA01', 1, 1, [0, 0]), ...items('MA02', 1, 1, [1, 1]), ...items('MA01', 2, 2, [1, 1]), ...items('MA02', 2, 2, [0, 0])]
    const base = { id: 1, segment: scope.segment, gradeYear: 5, subject: 'Matemática', academicYear: 2026, action: 'Retomada MA01', ownerName: 'Prof.', status: 'concluida', dueDate: null, createdAt: '2026-03-01T00:00:00.000Z' }
    const [whole] = buildTrajectory(evidence, [], [base])
    expect(whole.interventions[0]).toMatchObject({ change: 0, reading: 'sem_mudanca_relevante' })
    const [targeted] = buildTrajectory(evidence, [], [{ ...base, skillCodes: ['ma01'] }])
    expect(targeted.interventions[0]).toMatchObject({ before: { percent: 0, itemCount: 2 }, after: { percent: 100, itemCount: 2 }, change: 100, reading: 'melhora_posterior' })
  })

  it('na turma, a mesma questão de alunos diferentes conta para cada aluno', () => {
    const shared = { ...scope, code: 'MA01', bimester: 1, examId: 9, questionNumber: 1, possiblePoints: 1, assessedAt: '2026-02-01T00:00:00.000Z' }
    const rows = [{ ...shared, studentKey: 'a1', earnedPoints: 1 }, { ...shared, studentKey: 'a2', earnedPoints: 0 }, { ...shared, studentKey: 'a1', earnedPoints: 1 }]
    expect(dedupeEvidence(rows)).toHaveLength(2)
    const [t] = buildTrajectory(rows, [], [])
    expect(t.bimesters[0]).toMatchObject({ percent: 50, itemCount: 2, studentCount: 2 })
  })
})
