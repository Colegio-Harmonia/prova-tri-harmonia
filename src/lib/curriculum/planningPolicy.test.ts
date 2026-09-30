import { describe, expect, it } from 'vitest'
import { canEditPlan, canTransitionPlan, canViewPlan, planCopyDraft, validatePlanScope } from './planningPolicy'

const professor = { role: 'professor' as const, userId: 7, assignedUserIds: [7] }
const otherProfessor = { role: 'professor' as const, userId: 8, assignedUserIds: [7] }
const coordination = { role: 'coordenacao' as const, userId: 2, assignedUserIds: [] }

describe('política do planejamento curricular', () => {
  it('permite ao professor responsável ver e editar somente rascunhos atribuídos', () => {
    expect(canViewPlan(professor)).toBe(true)
    expect(canViewPlan(otherProfessor)).toBe(false)
    expect(canEditPlan(professor, 'rascunho')).toBe(true)
    expect(canEditPlan(professor, 'em_revisao')).toBe(false)
  })

  it('reserva aprovação, devolução e encerramento à gestão', () => {
    expect(canTransitionPlan(professor, 'rascunho', 'em_revisao')).toBe(true)
    expect(canTransitionPlan(professor, 'em_revisao', 'aprovado')).toBe(false)
    expect(canTransitionPlan(coordination, 'em_revisao', 'rascunho')).toBe(true)
    expect(canTransitionPlan(coordination, 'em_revisao', 'aprovado')).toBe(true)
    expect(canTransitionPlan(coordination, 'aprovado', 'encerrado')).toBe(true)
    expect(canTransitionPlan(coordination, 'encerrado', 'rascunho')).toBe(false)
  })

  it('copia somente versões consolidadas para um ano posterior e reinicia em rascunho', () => {
    expect(planCopyDraft({ versionId: 12, academicYear: 2026, status: 'aprovado' }, 2027)).toEqual({ academicYear: 2027, status: 'rascunho', source: 'copia', copiedFromVersionId: 12 })
    expect(() => planCopyDraft({ versionId: 12, academicYear: 2026, status: 'rascunho' }, 2027)).toThrow()
    expect(() => planCopyDraft({ versionId: 12, academicYear: 2026, status: 'encerrado' }, 2026)).toThrow()
  })

  it('valida os limites do recorte institucional', () => {
    expect(validatePlanScope({ academicYear: 2027, gradeYear: 5, bimester: 1, subject: 'Matemática' })).toBeNull()
    expect(validatePlanScope({ academicYear: 2027, gradeYear: 5, bimester: 5, subject: 'Matemática' })).toBe('Bimestre inválido.')
  })
})
