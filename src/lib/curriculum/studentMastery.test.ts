import { describe, expect, it } from 'vitest'
import { calculateStudentMastery, consolidateMastery, masteryLevel, type MasteryEvidenceItem } from './studentMastery'

const scope = { academicYear: 2026, segment: 'anos-iniciais', gradeYear: 5, subject: 'Língua Portuguesa', bimester: 1 }

function item(code: string, examId: number, questionNumber: number, earnedPoints: number, possiblePoints = 1, extra: Partial<MasteryEvidenceItem> = {}): MasteryEvidenceItem {
  return { ...scope, code, description: null, examId, questionNumber, earnedPoints, possiblePoints, ...extra }
}

describe('masteryLevel', () => {
  it('sem resposta é sem evidência; menos de 3 itens é evidência insuficiente', () => {
    expect(masteryLevel(null, 0, 0).level).toBe('sem_evidencia')
    expect(masteryLevel(100, 2, 2).level).toBe('evidencia_insuficiente')
  })

  it('só afirma domínio com itens e avaliações suficientes', () => {
    expect(masteryLevel(90, 4, 2)).toEqual({ level: 'dominio', limitedBySample: false })
    expect(masteryLevel(100, 5, 1)).toEqual({ level: 'proximo_do_dominio', limitedBySample: true })
    expect(masteryLevel(100, 3, 3)).toEqual({ level: 'proximo_do_dominio', limitedBySample: true })
  })

  it('separa próximo do domínio e em desenvolvimento pelas faixas', () => {
    expect(masteryLevel(79.9, 6, 2).level).toBe('proximo_do_dominio')
    expect(masteryLevel(60, 6, 2).level).toBe('proximo_do_dominio')
    expect(masteryLevel(59.9, 6, 2).level).toBe('em_desenvolvimento')
  })
})

describe('calculateStudentMastery', () => {
  it('mantém no relatório habilidades planejadas sem evidência', () => {
    const rows = calculateStudentMastery([{ ...scope, code: 'EF05LP01', description: 'Leitura', targetMasteryPercent: 100 }], [])
    expect(rows[0]).toMatchObject({ planned: true, masteryPercent: null, itemCount: 0, assessmentCount: 0, level: 'sem_evidencia' })
  })

  it('pondera pelo peso da questão e aceita pontuação parcial', () => {
    // Objetiva peso 1 errada + discursiva peso 3 com 2,5 pontos + objetiva certa em outra prova: 3,5/5 = 70%.
    const rows = calculateStudentMastery([], [
      item('EF05LP06', 1, 1, 0, 1),
      item('EF05LP06', 1, 2, 2.5, 3),
      item('EF05LP06', 2, 1, 1, 1),
    ])
    expect(rows[0]).toMatchObject({ earnedPoints: 3.5, possiblePoints: 5, masteryPercent: 70, itemCount: 3, assessmentCount: 2, level: 'proximo_do_dominio', planned: false })
  })

  it('não conta a mesma questão duas vezes e limita nota fora da escala', () => {
    const rows = calculateStudentMastery([], [item('EF05LP06', 1, 1, 5, 2), item('EF05LP06', 1, 1, 5, 2)])
    expect(rows[0]).toMatchObject({ earnedPoints: 2, possiblePoints: 2, itemCount: 1 })
  })

  it('ignora itens sem pontuação possível', () => {
    expect(calculateStudentMastery([], [item('EF05LP06', 1, 1, 0, 0)])).toEqual([])
  })
})

describe('consolidateMastery', () => {
  it('consolida por disciplina e bimestre sem contar duas vezes questão com dois códigos', () => {
    const evidence = [
      item('EF05LP06', 1, 1, 1), item('EF05LP07', 1, 1, 1), // mesma questão, dois códigos
      item('EF05LP06', 1, 2, 0),
      item('EF05LP06', 2, 1, 1, 1, { bimester: 2 }),
    ]
    const rows = calculateStudentMastery([{ ...scope, code: 'EF05LP10', description: null, targetMasteryPercent: 100 }], evidence)
    const { bySubjectBimester, bySubject } = consolidateMastery(rows, evidence)

    const first = bySubjectBimester.find((group) => group.bimester === 1)!
    expect(first).toMatchObject({ skillCount: 3, plannedSkillCount: 1, itemCount: 2, assessmentCount: 1, masteryPercent: 50 })
    expect(first.levelCounts.sem_evidencia).toBe(1)
    expect(first.levelCounts.evidencia_insuficiente).toBe(2)

    expect(bySubject).toHaveLength(1)
    expect(bySubject[0]).toMatchObject({ bimester: null, itemCount: 3, assessmentCount: 2, masteryPercent: 66.7 })
  })
})
