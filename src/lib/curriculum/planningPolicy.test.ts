import { describe, expect, it } from 'vitest'
import { canEditPlan, canReceiveNewDraft, canStartNewVersion, canTransitionPlan, canViewPlan, normalizePlanUnits, officialVersion, openVersion, planCopyDraft, validatePlanScope } from './planningPolicy'

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

describe('versões e conteúdo do planejamento (Bloco 7)', () => {
  const v = (id: number, versionNumber: number, status: 'rascunho' | 'em_revisao' | 'aprovado' | 'encerrado') => ({ id, versionNumber, status })

  it('versão oficial é a aprovada/encerrada mais recente; rascunho não vale', () => {
    expect(officialVersion([v(1, 1, 'aprovado'), v(2, 2, 'aprovado'), v(3, 3, 'rascunho')])?.id).toBe(2)
    expect(officialVersion([v(1, 1, 'rascunho')])).toBeNull()
    expect(openVersion([v(1, 1, 'aprovado'), v(3, 3, 'em_revisao')])?.id).toBe(3)
  })

  it('alteração de aprovado vira nova versão, uma de cada vez', () => {
    expect(canStartNewVersion(professor, [v(1, 1, 'aprovado')])).toEqual({ ok: true })
    expect(canStartNewVersion(professor, [v(1, 1, 'aprovado'), v(2, 2, 'rascunho')]).ok).toBe(false)
    expect(canStartNewVersion(otherProfessor, [v(1, 1, 'aprovado')]).ok).toBe(false)
  })

  it('bimestre encerrado bloqueia alteração direta; só a gestão reabre, com justificativa', () => {
    const closed = [v(1, 1, 'encerrado')]
    expect(canStartNewVersion(professor, closed).ok).toBe(false)
    expect(canStartNewVersion(coordination, closed).ok).toBe(false)
    expect(canStartNewVersion(coordination, closed, 'Correção de código BNCC trocado')).toEqual({ ok: true })
    expect(canReceiveNewDraft([v(1, 1, 'encerrado')])).toBe(true)
    expect(canReceiveNewDraft([v(1, 1, 'aprovado'), v(2, 2, 'em_revisao')])).toBe(false)
  })

  it('valida unidades, códigos BNCC, repetição e metas sem salvar parcial', () => {
    const ok = normalizePlanUnits([{ title: ' Frações ', skills: [{ code: 'ef05ma03 ', description: '' }] }])
    expect(ok.errors).toEqual([])
    expect(ok.units[0]).toEqual({ title: 'Frações', content: null, objectives: null, skills: [{ code: 'EF05MA03', description: null, targetMasteryPercent: 100 }] })
    const bad = normalizePlanUnits([{ title: '', skills: [{ code: 'XX1' }, { code: 'EF05MA03', targetMasteryPercent: 120 }, { code: 'EF05MA03' }] }])
    expect(bad.errors).toEqual([
      'Unidade 1: informe o título.',
      'Unidade 1: código BNCC inválido "XX1".',
      'Unidade 1: meta de EF05MA03 deve ser de 0 a 100.',
      'Unidade 1: habilidade EF05MA03 repetida.',
    ])
  })
})
