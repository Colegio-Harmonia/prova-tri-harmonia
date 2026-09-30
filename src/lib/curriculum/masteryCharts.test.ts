import { describe, expect, it } from 'vitest'
import { availablePeriods, chartCategory, heatBand, interpretSkills, interpretSubjects, skillHeatmap, skillRadar, subjectRadar } from './masteryCharts'
import { calculateStudentMastery, consolidateMastery, masteryLevel, type MasteryEvidenceItem } from './studentMastery'

const base = { academicYear: 2026, segment: 'anos-iniciais', gradeYear: 5, description: null }
function ev(subject: string, code: string, bimester: number, examId: number, q: number, earned: number): MasteryEvidenceItem {
  return { ...base, subject, bimester, code, examId, questionNumber: q, earnedPoints: earned, possiblePoints: 1 }
}

// LP: EF05LP06 nos bimestres 1 e 2 (2 provas, 4 itens, 100%) — só no ano chega a domínio.
const evidence = [
  ev('Língua Portuguesa', 'EF05LP06', 1, 1, 1, 1), ev('Língua Portuguesa', 'EF05LP06', 1, 1, 2, 1),
  ev('Língua Portuguesa', 'EF05LP06', 2, 2, 1, 1), ev('Língua Portuguesa', 'EF05LP06', 2, 2, 2, 1),
  ev('Língua Portuguesa', 'EF05LP07', 1, 1, 3, 0), ev('Língua Portuguesa', 'EF05LP07', 1, 1, 4, 0), ev('Língua Portuguesa', 'EF05LP07', 1, 1, 5, 1),
  ev('Ciências', 'EF05CI08', 1, 3, 1, 1),
]
const planned = [{ ...base, subject: 'Língua Portuguesa', bimester: 1, code: 'EF05LP10', targetMasteryPercent: 100 }]
const rows = calculateStudentMastery(planned, evidence)
const consolidated = consolidateMastery(rows, evidence)

describe('masteryCharts', () => {
  it('mapeia os cinco níveis nas três leituras visuais', () => {
    expect(chartCategory('dominio')).toBe('dominada')
    expect(chartCategory('proximo_do_dominio')).toBe('em_desenvolvimento')
    expect(chartCategory('evidencia_insuficiente')).toBe('em_desenvolvimento')
    expect(chartCategory('sem_evidencia')).toBe('nao_avaliada')
  })

  it('lista anos e bimestres disponíveis', () => {
    expect(availablePeriods(rows)).toEqual([{ academicYear: 2026, bimesters: [1, 2] }])
  })

  it('teia geral usa consolidação anual ou do bimestre escolhido', () => {
    const anual = subjectRadar(consolidated, { academicYear: 2026, bimester: null })
    expect(anual.map((axis) => [axis.label, axis.value, axis.itemCount])).toEqual([['Ciências', 100, 1], ['Língua Portuguesa', 71.4, 7]])
    expect(anual[0].preliminary).toBe(true)
    const bim2 = subjectRadar(consolidated, { academicYear: 2026, bimester: 2 })
    expect(bim2.map((axis) => axis.label)).toEqual(['Língua Portuguesa'])
  })

  it('teia por habilidade junta bimestres e recalcula o nível no ano', () => {
    const axes = skillRadar(rows, 'Língua Portuguesa', { academicYear: 2026, bimester: null }, masteryLevel)
    const lp06 = axes.find((axis) => axis.key === 'EF05LP06')!
    expect(lp06).toMatchObject({ value: 100, itemCount: 4, assessmentCount: 2, level: 'dominio', category: 'dominada' })
    expect(axes.find((axis) => axis.key === 'EF05LP10')).toMatchObject({ value: null, category: 'nao_avaliada' })
    // No 1º bimestre sozinho, a mesma habilidade não sustenta domínio.
    const bim1 = skillRadar(rows, 'Língua Portuguesa', { academicYear: 2026, bimester: 1 }, masteryLevel)
    expect(bim1.find((axis) => axis.key === 'EF05LP06')?.category).toBe('em_desenvolvimento')
  })

  it('mapa de calor por habilidade e bimestre', () => {
    const heat = skillHeatmap(rows, 'Língua Portuguesa', 2026)
    expect(heat.bimesters).toEqual([1, 2])
    expect(heat.rows.find((row) => row.code === 'EF05LP07')?.cells).toEqual([{ value: 33.3, level: 'em_desenvolvimento', itemCount: 3 }, null])
    expect([heatBand(null), heatBand(10), heatBand(45), heatBand(70), heatBand(90)]).toEqual([0, 1, 2, 3, 4])
  })

  it('interpretação não compara disciplina com amostra preliminar', () => {
    const notes = interpretSubjects(subjectRadar(consolidated, { academicYear: 2026, bimester: null }))
    expect(notes[0]).toContain('Só Língua Portuguesa tem evidência suficiente')
    expect(notes.join(' ')).toContain('Leitura preliminar (menos de 3 itens): Ciências')
    const skillNotes = interpretSkills(skillRadar(rows, 'Língua Portuguesa', { academicYear: 2026, bimester: null }, masteryLevel))
    expect(skillNotes[0]).toBe('1 dominada(s), 1 em desenvolvimento e 1 ainda não avaliada(s), de 3 habilidade(s).')
    expect(skillNotes[1]).toContain('EF05LP07 (33,3%)')
  })
})
