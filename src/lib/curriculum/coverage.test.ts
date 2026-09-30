import { describe, expect, it } from 'vitest'
import { calculateCurriculumCoverage } from './coverage'

describe('calculateCurriculumCoverage', () => {
  it('separa habilidade avaliada, pendente, fora do plano e questão sem BNCC', () => {
    const result = calculateCurriculumCoverage(
      [
        { code: 'EF05LP01', description: 'Ler textos' },
        { code: 'EF05LP02', description: 'Produzir textos' },
      ],
      [
        { key: '10:1', codes: ['ef05lp01'], evaluatedAnswerCount: 12 },
        { key: '10:2', codes: ['EF05LP99'], evaluatedAnswerCount: 8 },
        { key: '10:3', codes: [], evaluatedAnswerCount: 7 },
      ],
    )

    expect(result).toMatchObject({
      plannedSkillCount: 2,
      assessedPlannedSkillCount: 1,
      pendingPlannedSkillCount: 1,
      outsidePlanSkillCount: 1,
      mappedItemCount: 2,
      unmappedItemCount: 1,
      unmappedEvaluatedAnswerCount: 7,
    })
    expect(result.rows.map(({ code, status }) => ({ code, status }))).toEqual(expect.arrayContaining([
      { code: 'EF05LP01', status: 'planejada_avaliada' },
      { code: 'EF05LP02', status: 'planejada_nao_avaliada' },
      { code: 'EF05LP99', status: 'fora_planejamento' },
    ]))
  })

  it('não considera item preparado sem resposta revisada como habilidade avaliada', () => {
    const result = calculateCurriculumCoverage(
      [{ code: 'EF05MA01', description: null }],
      [{ key: '20:1', codes: ['EF05MA01'], evaluatedAnswerCount: 0 }],
    )
    expect(result.rows[0]).toMatchObject({ itemCount: 1, evaluatedAnswerCount: 0, status: 'planejada_nao_avaliada' })
  })

  it('não duplica questão nem código repetido', () => {
    const result = calculateCurriculumCoverage(
      [{ code: 'EF05CI01', description: null }],
      [{ key: '30:1', codes: ['EF05CI01', 'ef05ci01'], evaluatedAnswerCount: 2 }],
    )
    expect(result.rows[0]).toMatchObject({ itemCount: 1, evaluatedAnswerCount: 2 })
  })
})
