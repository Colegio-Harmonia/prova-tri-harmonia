import { describe, expect, it } from 'vitest'
import { calculateStudentMastery, type MasteryEvidenceItem, type PlannedMasterySkill } from '@/lib/curriculum/studentMastery'
import { distributeRecoveryQuestions, evidenceForPeriod, plannedForPeriod, selectRecoverySkills } from './recoveryPlan'

const scope = { academicYear: 2026, segment: 'anos-finais', gradeYear: 7, subject: 'Matemática' }

function item(code: string, bimester: number, examId: number, questionNumber: number, earned: number): MasteryEvidenceItem {
  return { ...scope, bimester, code, description: null, examId, questionNumber, earnedPoints: earned, possiblePoints: 1 }
}

function plan(code: string, bimester: number): PlannedMasterySkill {
  return { ...scope, bimester, code, description: `Descrição ${code}`, targetMasteryPercent: 80 }
}

describe('selectRecoverySkills', () => {
  it('leva só as habilidades abaixo de 60% com amostra suficiente, da mais fraca para a mais forte', () => {
    const evidence = [
      // EF07MA01: 1/4 = 25% → fraca
      item('EF07MA01', 1, 1, 1, 0), item('EF07MA01', 1, 1, 2, 0), item('EF07MA01', 1, 2, 1, 1), item('EF07MA01', 1, 2, 2, 0),
      // EF07MA02: 2/4 = 50% → fraca
      item('EF07MA02', 1, 1, 3, 1), item('EF07MA02', 1, 1, 4, 0), item('EF07MA02', 1, 2, 3, 1), item('EF07MA02', 1, 2, 4, 0),
      // EF07MA03: 3/4 = 75% → próximo do domínio, fica de fora
      item('EF07MA03', 1, 1, 5, 1), item('EF07MA03', 1, 1, 6, 1), item('EF07MA03', 1, 2, 5, 1), item('EF07MA03', 1, 2, 6, 0),
      // EF07MA04: 0/2 → evidência insuficiente, vira aviso
      item('EF07MA04', 1, 1, 7, 0), item('EF07MA04', 1, 2, 7, 0),
    ]
    const rows = calculateStudentMastery([plan('EF07MA05', 1)], evidence)
    const { weak, insufficient } = selectRecoverySkills(rows)
    expect(weak.map((skill) => skill.code)).toEqual(['EF07MA01', 'EF07MA02'])
    expect(weak[0]).toMatchObject({ masteryPercent: 25, itemCount: 4 })
    expect(insufficient.map((skill) => skill.code)).toEqual(['EF07MA04'])
  })

  it('no ano todo, soma os bimestres de um mesmo código numa leitura só', () => {
    // Bimestre 1: 0/2 (insuficiente sozinho). Bimestre 3: 1/2. Ano: 1/4 = 25%.
    const evidence = [item('EF07MA01', 1, 1, 1, 0), item('EF07MA01', 1, 1, 2, 0), item('EF07MA01', 3, 5, 1, 1), item('EF07MA01', 3, 5, 2, 0)]
    const planned = [plan('EF07MA01', 1), plan('EF07MA01', 3)]
    const byBimester = selectRecoverySkills(calculateStudentMastery(plannedForPeriod(planned, 1), evidenceForPeriod(evidence, 1)))
    expect(byBimester.weak).toEqual([])
    expect(byBimester.insufficient.map((skill) => skill.code)).toEqual(['EF07MA01'])

    const year = selectRecoverySkills(calculateStudentMastery(plannedForPeriod(planned, null), evidenceForPeriod(evidence, null)))
    expect(year.weak).toEqual([expect.objectContaining({ code: 'EF07MA01', masteryPercent: 25, itemCount: 4 })])
  })
})

describe('distributeRecoveryQuestions', () => {
  const skill = (code: string, masteryPercent: number) => ({ code, description: null, masteryPercent, itemCount: 4 })

  it('soma exatamente a quantidade pedida e dá mais questões a quem está mais longe de 60%', () => {
    const plan = distributeRecoveryQuestions([skill('A', 10), skill('B', 40), skill('C', 55)], 10)
    expect(plan.reduce((sum, entry) => sum + entry.questionCount, 0)).toBe(10)
    expect(plan.every((entry) => entry.questionCount >= 1)).toBe(true)
    const [a, b, c] = plan
    expect(a!.questionCount).toBeGreaterThan(b!.questionCount)
    expect(b!.questionCount).toBeGreaterThanOrEqual(c!.questionCount)
  })

  it('com mais habilidades que questões, fica com as mais fracas (a lista já vem ordenada)', () => {
    const plan = distributeRecoveryQuestions([skill('A', 0), skill('B', 10), skill('C', 20), skill('D', 30)], 3)
    expect(plan).toEqual([{ code: 'A', questionCount: 1 }, { code: 'B', questionCount: 1 }, { code: 'C', questionCount: 1 }])
  })

  it('sem habilidade fraca não planeja nada', () => {
    expect(distributeRecoveryQuestions([], 10)).toEqual([])
  })
})
