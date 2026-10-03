import { describe, expect, it } from 'vitest'
import { buildCurriculumFromPlan, planIdFromExamPayload, type PlanUnitRow } from './planCurriculum'

const scope = { segment: 'anos-finais' as const, gradeYear: 8, subject: 'Matemática', bimester: 4 }

const rows: PlanUnitRow[] = [
  {
    position: 1,
    title: 'Circunferências',
    content: '• Elementos da circunferência',
    objectives: 'Calcular o comprimento da circunferência e a área do círculo em situações-problema.\nClassificar as posições relativas entre uma reta e uma circunferência.',
    skills: [{ code: 'EF08MA19', description: 'Resolver e elaborar problemas que envolvam medidas de área.' }],
  },
  { position: 0, title: 'Coordenadas cartesianas', content: null, objectives: null, skills: [] },
]

describe('buildCurriculumFromPlan', () => {
  const curriculum = buildCurriculumFromPlan(scope, 'Planejamento interno #9 (versão 1)', rows)

  it('mantém o recorte e identifica a origem', () => {
    expect(curriculum).toMatchObject({ segment: 'anos-finais', gradeYear: 8, subject: 'Matemática', bimester: 4, tabName: 'Planejamento interno #9 (versão 1)' })
  })

  it('ordena por posição e usa a posição como rowIndex, único', () => {
    expect(curriculum.units.map((unit) => unit.rowIndex)).toEqual([0, 1])
    expect(curriculum.units.map((unit) => unit.tituloCapitulo)).toEqual(['Coordenadas cartesianas', 'Circunferências'])
  })

  it('leva habilidades com descrição e marca a unidade sem habilidade como não mapeada', () => {
    const [semHabilidade, comHabilidade] = curriculum.units
    expect(comHabilidade.habilidades).toEqual({ status: 'mapeado', skills: [{ code: 'EF08MA19', description: 'Resolver e elaborar problemas que envolvam medidas de área.' }] })
    expect(semHabilidade.habilidades.status).toBe('nao_mapeado')
    expect(curriculum.unmappedWarnings).toHaveLength(1)
    expect(curriculum.unmappedWarnings[0]).toContain('Coordenadas cartesianas')
  })

  it('coloca os objetivos no conteúdo enriquecido, que é o que chega ao prompt de geração', () => {
    const comObjetivos = curriculum.units[1]
    expect(comObjetivos.enrichedContent).toContain('Calcular o comprimento da circunferência')
    expect(comObjetivos.enrichedObjectives).toContain('Classificar as posições relativas')
    expect(comObjetivos.objetivos).toHaveLength(2)
    expect(comObjetivos.objetivosColumnMissing).toBe(false)
  })

  it('unidade sem objetivos não inventa conteúdo enriquecido', () => {
    const semObjetivos = curriculum.units[0]
    expect(semObjetivos.enrichedContent).toBeNull()
    expect(semObjetivos.objetivosColumnMissing).toBe(true)
    expect(semObjetivos.objetivos).toEqual([])
  })

  it('não altera a lista recebida', () => {
    expect(rows.map((row) => row.position)).toEqual([1, 0])
  })
})

describe('planIdFromExamPayload', () => {
  it('lê o id gravado na prova', () => {
    expect(planIdFromExamPayload({ metadata: { curriculumPlanId: 9 } })).toBe(9)
  })

  it('devolve undefined quando a prova veio da planilha ou o valor é inválido', () => {
    expect(planIdFromExamPayload({ metadata: {} })).toBeUndefined()
    expect(planIdFromExamPayload(null)).toBeUndefined()
    expect(planIdFromExamPayload({ metadata: { curriculumPlanId: '9' } })).toBeUndefined()
    expect(planIdFromExamPayload({ metadata: { curriculumPlanId: 0 } })).toBeUndefined()
    expect(planIdFromExamPayload({ metadata: { curriculumPlanId: 1.5 } })).toBeUndefined()
  })
})
