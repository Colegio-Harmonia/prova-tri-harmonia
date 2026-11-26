import { describe, expect, it } from 'vitest'
import { calculateStudentMastery, type MasteryEvidenceItem, type PlannedMasterySkill } from '@/lib/curriculum/studentMastery'
import { buildRecoveryContentPlan, distributeRecoveryQuestions, evidenceForPeriod, periodBimesters, periodLabel, plannedForPeriod, selectRecoverySkills, validateRecoveryContentPlan } from './recoveryPlan'

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
    const byBimester = selectRecoverySkills(calculateStudentMastery(plannedForPeriod(planned, { bimester: 1 }), evidenceForPeriod(evidence, { bimester: 1 })))
    // Sozinho no 1º bimestre (0/2) só entra pelo fallback de amostra pequena.
    expect(byBimester.weak).toEqual([expect.objectContaining({ code: 'EF07MA01', masteryPercent: 0, itemCount: 2, smallSample: true })])
    expect(byBimester.insufficient).toEqual([])

    const year = selectRecoverySkills(calculateStudentMastery(plannedForPeriod(planned, { bimester: null }), evidenceForPeriod(evidence, { bimester: null })))
    expect(year.weak).toEqual([expect.objectContaining({ code: 'EF07MA01', masteryPercent: 25, itemCount: 4 })])
    expect(year.weak[0]!.smallSample).toBeUndefined()
  })

  it('sem nenhuma fraca com amostra suficiente, leva as de amostra pequena abaixo de 60% (marcadas)', () => {
    // Caso do lote 7: uma prova só no semestre, uma questão por habilidade.
    const evidence = [item('EF07MA01', 3, 5, 1, 0), item('EF07MA02', 3, 5, 2, 0.5), item('EF07MA03', 3, 5, 3, 1)]
    const { weak, insufficient } = selectRecoverySkills(calculateStudentMastery([], evidenceForPeriod(evidence, { bimester: null, semester: 2 })))
    expect(weak.map((skill) => [skill.code, skill.masteryPercent, skill.smallSample])).toEqual([['EF07MA01', 0, true], ['EF07MA02', 50, true]])
    expect(insufficient.map((skill) => skill.code)).toEqual(['EF07MA03'])
  })

  it('com alguma fraca de amostra suficiente, a amostra pequena continua de fora', () => {
    const evidence = [
      item('EF07MA01', 1, 1, 1, 0), item('EF07MA01', 1, 1, 2, 0), item('EF07MA01', 1, 2, 1, 1), item('EF07MA01', 1, 2, 2, 0),
      item('EF07MA02', 1, 1, 3, 0),
    ]
    const { weak, insufficient } = selectRecoverySkills(calculateStudentMastery([], evidence))
    expect(weak.map((skill) => skill.code)).toEqual(['EF07MA01'])
    expect(insufficient.map((skill) => skill.code)).toEqual(['EF07MA02'])
  })

  it('no semestre, soma só os dois bimestres dele', () => {
    // 1º bim: 0/2; 2º bim: 1/2 → 1º semestre 1/4 = 25%. O 3º bim (2/2) fica de fora.
    const evidence = [item('EF07MA01', 1, 1, 1, 0), item('EF07MA01', 1, 1, 2, 0), item('EF07MA01', 2, 3, 1, 1), item('EF07MA01', 2, 3, 2, 0), item('EF07MA01', 3, 5, 1, 1), item('EF07MA01', 3, 5, 2, 1)]
    const first = selectRecoverySkills(calculateStudentMastery([], evidenceForPeriod(evidence, { bimester: null, semester: 1 })))
    expect(first.weak).toEqual([expect.objectContaining({ code: 'EF07MA01', masteryPercent: 25, itemCount: 4 })])
    const second = selectRecoverySkills(calculateStudentMastery([], evidenceForPeriod(evidence, { bimester: null, semester: 2 })))
    expect(second.weak).toEqual([])
    expect(second.insufficient.map((skill) => skill.code)).toEqual(['EF07MA01'])
    expect(periodBimesters({ bimester: null, semester: 2 })).toEqual([3, 4])
    expect(periodLabel(null, 1)).toBe('1º semestre')
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

describe('buildRecoveryContentPlan', () => {
  const weak = [
    { code: 'EF07MA01', description: null, masteryPercent: 10, itemCount: 4 },
    { code: 'EF07MA02', description: null, masteryPercent: 50, itemCount: 4 },
    { code: 'EF07MA09', description: null, masteryPercent: 30, itemCount: 4 },
  ]
  const units = [
    { rowIndex: 0, codes: ['EF07MA01', 'EF07MA05'] },
    { rowIndex: 1, codes: ['EF07MA02'] },
    { rowIndex: 2, codes: ['EF07MA05'] },
    { rowIndex: 1000, codes: ['ef07ma01'] },
  ]

  it('distribui o total pelos capítulos com habilidade fraca, mais para os mais fracos', () => {
    const { contentPlan, unplannedCodes } = buildRecoveryContentPlan(units, weak, 12)
    expect(contentPlan.map((item) => item.unitRowIndex)).toEqual([0, 1, 1000])
    expect(contentPlan.reduce((sum, item) => sum + item.questionCount, 0)).toBe(12)
    // EF07MA01 (déficit 50) divide entre os capítulos 0 e 1000; EF07MA02 (déficit 10) fica no 1.
    const byRow = Object.fromEntries(contentPlan.map((item) => [item.unitRowIndex, item.questionCount]))
    expect(byRow[0]).toBeGreaterThan(byRow[1]!)
    expect(unplannedCodes).toEqual(['EF07MA09'])
    expect(validateRecoveryContentPlan(contentPlan, units.map((unit) => unit.rowIndex), 12)).toBeNull()
  })

  it('valida soma, capítulo desconhecido e repetição', () => {
    const plan = [{ unitRowIndex: 0, questionCount: 5, priority: 'alta' as const, visualAid: 'auto' as const }]
    expect(validateRecoveryContentPlan(plan, [0], 12)).toMatch(/soma 5/)
    expect(validateRecoveryContentPlan([{ ...plan[0]!, unitRowIndex: 9, questionCount: 12 }], [0], 12)).toMatch(/não pertence/)
    expect(validateRecoveryContentPlan([{ ...plan[0]!, questionCount: 6 }, { ...plan[0]!, questionCount: 6 }], [0], 12)).toMatch(/uma vez/)
  })
})
