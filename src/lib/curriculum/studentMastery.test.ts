import { describe, expect, it } from 'vitest'
import { calculateStudentMastery, masteryStatus } from './studentMastery'

const scope = { academicYear: 2026, segment: 'anos-iniciais', gradeYear: 5, subject: 'Língua Portuguesa', bimester: 1 }

describe('student mastery', () => {
  it('mantém no relatório habilidades planejadas sem evidência', () => {
    const rows = calculateStudentMastery([
      { ...scope, code: 'EF05LP01', description: 'Leitura', targetMasteryPercent: 100 },
    ], [])
    expect(rows[0]).toMatchObject({ planned: true, masteryPercent: null, evidenceCount: 0, status: 'sem_evidencia' })
  })

  it('não transforma uma ou duas respostas em domínio', () => {
    expect(masteryStatus(100, 2)).toBe('amostra_insuficiente')
    expect(masteryStatus(100, 3)).toBe('dominio')
  })

  it('calcula o percentual e identifica evidência fora do planejamento', () => {
    const rows = calculateStudentMastery([], [
      { ...scope, code: 'EF05LP99', description: 'Outra', scoreSum: 20, evidenceCount: 4 },
    ])
    expect(rows[0]).toMatchObject({ planned: false, masteryPercent: 50, evidenceCount: 4, status: 'prioridade' })
  })
})
