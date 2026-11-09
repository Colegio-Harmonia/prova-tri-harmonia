import { describe, expect, it } from 'vitest'
import { buildCurriculumFromPlan, type PlanUnitRow } from './planCurriculum'
import { normalizePlanUnits } from './planningPolicy'
import { pickTargetEnemSkill } from '@/lib/exams/targetSkills'

// Inglês, 1º ano EM — exatamente os dados recebidos do planejamento real.
const PLAN: Record<string, string> = {
  'Leadership through empowerment': `C4:H14 (Enem-2020)
C2:H7 (Enem-2021)
C2:H6
C2:H5 (UFT-2020)
C2:H6 (UFT-2020)
C2:H5 (Unesp-2022)
C2:H5 (Unesp-2022)
C2:H5 (Unesp-2022)
C2:H7 (PUC Minas-2019)
C2:H5 (PUC Minas-2019)
C2:H7 (UEMA-2021)`,
  'Self-knowledge to thrive': `C2:H6 (URCA-2021)
C2:H5 (URCA-2021)
C7:H21 (UNEB-2018)
C7:H24 (PUC Goiás-2020)
C7:H24 (PUC Goiás-2020)
C2:H5 (UPE-2021)
C2:H5 (UPE-2021)
C2:H5 (FGV-2020)
C2:H5 (FGV-2020)
C2:H6 (UFSC-2019)`,
  'Dreaming is the willpower to succeed': `C1:H3 (Enem-2021)
C1:H2 (Enem-2020)
C2:H5 (FGV-2020)
C2:H7 (FGV-2020)
C2:H7 (Vunesp-2018)
C2:H7 (Vunesp-2018)
C9:H30 (Vunesp-2018)
C6:H18 (PUC-Rio Rio-2016)
C6:H18 (CECIERJ-2022)`,
  'Leading is changing': `C2:H7 (IFSULDEMINAS-2022)
C6:H18 (IFSULDEMINAS-2022)
C2:H5 (UFT-2019)
C2:H5 (UFT-2019)
C2:H5 (UFT-2019)
C7:H21 (Unicentro-2017)
C2:H5 (Unicentro-2017)
C2:H5 (Unicentro-2017)
C2:H5 (PUC-Rio-2019)
C2:H5 (PUC-Rio-2019)
C2:H5 (PUC-Rio-2019)`,
}

const rows: PlanUnitRow[] = Object.entries(PLAN).map(([title, enemSkills], position) => ({
  position, title, content: null, objectives: null, enemSkills, skills: [],
}))
const scope = { segment: 'ensino-medio' as const, gradeYear: 1, subject: 'Inglês', bimester: 4 }

describe('planejamento interno de Inglês 1º EM pela Matriz do ENEM', () => {
  const curriculum = buildCurriculumFromPlan(scope, 'Planejamento interno #X (versão 1)', rows)

  it('todos os códigos recebidos existem na matriz de Linguagens', () => {
    for (const unit of curriculum.units) expect(unit.enemSkills?.invalid).toEqual([])
    expect(curriculum.unmappedWarnings).toEqual([])
  })

  it('cada capítulo carrega os pesos do material', () => {
    const weights = Object.fromEntries(curriculum.units.map((unit) => [unit.tituloCapitulo, unit.enemSkills!.skills.map((s) => `${s.code}×${s.count}`)]))
    expect(weights).toEqual({
      'Leadership through empowerment': ['C2:H5×5', 'C2:H6×2', 'C2:H7×3', 'C4:H14×1'].sort(byWeightThenCode),
      'Self-knowledge to thrive': ['C2:H5×5', 'C2:H6×2', 'C7:H21×1', 'C7:H24×2'].sort(byWeightThenCode),
      'Dreaming is the willpower to succeed': ['C1:H2×1', 'C1:H3×1', 'C2:H5×1', 'C2:H7×3', 'C6:H18×2', 'C9:H30×1'].sort(byWeightThenCode),
      'Leading is changing': ['C2:H5×8', 'C2:H7×1', 'C6:H18×1', 'C7:H21×1'].sort(byWeightThenCode),
    })
  })

  it('uma prova de 12 questões (3 por capítulo) cobre as habilidades mais pesadas de cada capítulo', () => {
    const picks = curriculum.units.map((unit) => [0, 1, 2].map((i) => pickTargetEnemSkill({ unit, slotIndexInUnit: i })?.code))
    expect(picks).toEqual([
      ['C2:H5', 'C2:H7', 'C2:H6'],
      ['C2:H5', 'C2:H6', 'C7:H24'],
      ['C2:H7', 'C6:H18', 'C1:H2'],
      ['C2:H5', 'C2:H5', 'C2:H7'],
    ])
  })

  it('o editor recusa texto sem nenhum código C:H', () => {
    expect(normalizePlanUnits([{ title: 'X', enemSkills: 'H5 Unesp', skills: [] }]).errors[0]).toMatch(/nenhum código ENEM reconhecido/)
    expect(normalizePlanUnits([{ title: 'X', enemSkills: PLAN['Leading is changing'], skills: [] }]).errors).toEqual([])
  })
})

function byWeightThenCode(a: string, b: string) {
  const [ca, wa] = a.split('×'); const [cb, wb] = b.split('×')
  const [, a1, a2] = ca!.match(/C(\d+):H(\d+)/)!.map(Number); const [, b1, b2] = cb!.match(/C(\d+):H(\d+)/)!.map(Number)
  return Number(wb) - Number(wa) || a1! - b1! || a2! - b2!
}
